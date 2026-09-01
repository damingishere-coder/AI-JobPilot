package com.getjobs.application.service;

import com.getjobs.application.dto.ResumeParseResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

@Service
@Slf4j
@RequiredArgsConstructor
public class ResumeDocumentParsingService {
    public static final long MAX_FILE_SIZE = 30L * 1024 * 1024;
    public static final int AI_REVIEW_THRESHOLD = 85;
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx", ".txt"
    );
    private static final Set<String> IMAGE_EXTENSIONS = Set.of(".png", ".jpg", ".jpeg", ".webp");
    private static final Pattern CONTACT_PATTERN = Pattern.compile(
            "(?i)(1[3-9]\\d{9}|[\\w.%+-]+@[\\w.-]+\\.[A-Z]{2,}|(?:电话|手机|邮箱|邮件))"
    );
    private static final Pattern SECTION_PATTERN = Pattern.compile(
            "(工作经历|项目经历|教育背景|专业技能|个人信息|work experience|education|project)",
            Pattern.CASE_INSENSITIVE
    );

    private final LocalResumeParserService localResumeParserService;
    private final AiService aiService;

    @Value("${app.resume-parser.max-pages:10}")
    private int maxPages;

    @Value("${app.resume-parser.max-output-chars:200000}")
    private int maxOutputChars;

    public ResumeParseResult parse(MultipartFile file, String requestedMode) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("上传文件不能为空");
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException("文件超过30MB限制，请压缩后重试");
        }
        String filename = safeFilename(file.getOriginalFilename());
        String extension = extensionOf(filename);
        if (!ALLOWED_EXTENSIONS.contains(extension)) {
            throw new IllegalArgumentException("不支持的简历格式：" + extension);
        }
        ParseMode mode = ParseMode.from(requestedMode);

        try {
            byte[] bytes = file.getBytes();
            validateSignature(bytes, extension);
            List<String> warnings = new ArrayList<>();
            String localText = "";
            String localMethod = "local-docling";
            RuntimeException localFailure = null;

            if (".txt".equals(extension)) {
                localText = decodeText(bytes, warnings);
                localMethod = "local-text";
            } else {
                if (".pdf".equals(extension)) validatePdfPageCount(bytes);
                try {
                    LocalResumeParserService.LocalParseOutput output = localResumeParserService.parse(bytes, extension);
                    localText = output.text();
                    localMethod = "local-" + output.method();
                    warnings.addAll(output.warnings());
                    if (output.pageCount() > maxPages) {
                        throw new IllegalArgumentException("文档超过" + maxPages + "页限制");
                    }
                } catch (RuntimeException e) {
                    localFailure = e;
                    warnings.add("本地识别失败：" + conciseMessage(e));
                }
            }

            localText = normalizeResumeText(localText);
            int localQuality = qualityScore(localText);
            boolean visualReviewSupported = ".pdf".equals(extension) || IMAGE_EXTENSIONS.contains(extension);
            boolean shouldReview = visualReviewSupported
                    && mode != ParseMode.LOCAL
                    && (mode == ParseMode.AI_REVIEW || localText.isBlank() || localQuality < AI_REVIEW_THRESHOLD);

            if (shouldReview) {
                warnings.add("简历页面已发送给当前 AI Provider 进行一次视觉复核");
                try {
                    List<AiService.ResumeImage> images = buildReviewImages(bytes, extension, file.getContentType());
                    String reviewed = normalizeResumeText(aiService.reviewResumeImages(images, localText));
                    if (reviewed.isBlank()) {
                        throw new IllegalStateException("AI复核未返回文本");
                    }
                    int reviewedQuality = qualityScore(reviewed);
                    if (reviewedQuality < AI_REVIEW_THRESHOLD) {
                        warnings.add("AI复核后仍为低置信度，请逐项核对后再保存");
                    }
                    return new ResumeParseResult(
                            limit(reviewed),
                            limit(localText),
                            filename,
                            "ai-reviewed",
                            reviewedQuality,
                            warnings
                    );
                } catch (RuntimeException e) {
                    warnings.add("AI复核失败，未自动重试：" + conciseMessage(e));
                    if (localText.isBlank()) {
                        throw new IllegalStateException("本地识别和AI复核均失败，未保存任何内容", e);
                    }
                }
            }

            if (localText.isBlank()) {
                if (localFailure != null) throw localFailure;
                throw new IllegalStateException("文档未识别到可用文本，未保存任何内容");
            }
            if (localQuality < AI_REVIEW_THRESHOLD) {
                warnings.add("本地识别置信度较低，请编辑核对或手动发起AI复核");
            }
            if ((".doc".equals(extension) || ".docx".equals(extension)) && localQuality < AI_REVIEW_THRESHOLD) {
                warnings.add("如Word主要由截图或复杂浮动排版组成，请改传原图或PDF以提高识别率");
            }
            return new ResumeParseResult(
                    limit(localText),
                    limit(localText),
                    filename,
                    localMethod,
                    localQuality,
                    warnings
            );
        } catch (IOException e) {
            throw new IllegalStateException("无法读取上传文件", e);
        }
    }

    public String normalizeResumeText(String input) {
        if (input == null || input.isBlank()) return "";
        StringBuilder normalized = new StringBuilder(input.length());
        input.codePoints().forEach(codePoint -> {
            if (isCompatibilityIdeograph(codePoint)) {
                normalized.append(Normalizer.normalize(
                        new String(Character.toChars(codePoint)), Normalizer.Form.NFKC));
            } else if (codePoint == '\r') {
                // 在下方统一换行。
                normalized.append('\r');
            } else if (codePoint == '\n' || codePoint == '\t' || !Character.isISOControl(codePoint)) {
                normalized.appendCodePoint(codePoint);
            }
        });
        return normalized.toString()
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replace('\u00a0', ' ')
                .replaceAll("[ \\t]+\\n", "\n")
                .replaceAll("\\n{4,}", "\n\n\n")
                .trim();
    }

    public int qualityScore(String text) {
        if (text == null || text.isBlank()) return 0;
        int score = 100;
        int length = text.codePointCount(0, text.length());
        if (length < 80) score -= 45;
        else if (length < 200) score -= 25;
        else if (length < 400) score -= 10;

        long replacement = text.codePoints().filter(cp -> cp == 0xfffd).count();
        long suspicious = text.codePoints().filter(cp ->
                Character.getType(cp) == Character.PRIVATE_USE
                        || (Character.isISOControl(cp) && cp != '\n' && cp != '\t')).count();
        if (replacement > 0) score -= Math.min(40, 10 + (int) replacement * 3);
        if (suspicious > 0) score -= Math.min(30, 10 + (int) suspicious * 2);
        if (!CONTACT_PATTERN.matcher(text).find()) score -= 8;
        if (!SECTION_PATTERN.matcher(text).find()) score -= 10;

        String[] nonBlankLines = text.lines().map(String::trim).filter(line -> !line.isEmpty()).toArray(String[]::new);
        if (nonBlankLines.length >= 8) {
            long singleCharacterLines = java.util.Arrays.stream(nonBlankLines)
                    .filter(line -> line.codePointCount(0, line.length()) <= 1)
                    .count();
            if (singleCharacterLines * 3 > nonBlankLines.length) score -= 20;
        }
        return Math.max(0, Math.min(100, score));
    }

    private List<AiService.ResumeImage> buildReviewImages(byte[] bytes, String extension, String contentType) {
        if (IMAGE_EXTENSIONS.contains(extension)) {
            String mime = contentType == null || contentType.isBlank() ? mimeForExtension(extension) : contentType;
            return List.of(new AiService.ResumeImage(bytes, mime));
        }
        if (!".pdf".equals(extension)) return List.of();
        try (PDDocument document = Loader.loadPDF(bytes)) {
            if (document.getNumberOfPages() > maxPages) {
                throw new IllegalArgumentException("PDF超过" + maxPages + "页限制");
            }
            PDFRenderer renderer = new PDFRenderer(document);
            List<AiService.ResumeImage> images = new ArrayList<>();
            for (int index = 0; index < document.getNumberOfPages(); index++) {
                BufferedImage image = renderer.renderImageWithDPI(index, 140, ImageType.RGB);
                images.add(new AiService.ResumeImage(toJpeg(image), "image/jpeg"));
            }
            return images;
        } catch (IOException e) {
            throw new IllegalStateException("无法渲染PDF页面供AI复核", e);
        }
    }

    private byte[] toJpeg(BufferedImage image) throws IOException {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpeg");
        if (!writers.hasNext()) throw new IOException("当前Java环境不支持JPEG编码");
        ImageWriter writer = writers.next();
        try (ByteArrayOutputStream output = new ByteArrayOutputStream();
             ImageOutputStream imageOutput = ImageIO.createImageOutputStream(output)) {
            writer.setOutput(imageOutput);
            ImageWriteParam params = writer.getDefaultWriteParam();
            if (params.canWriteCompressed()) {
                params.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                params.setCompressionQuality(0.82f);
            }
            writer.write(null, new IIOImage(image, null, null), params);
            return output.toByteArray();
        } finally {
            writer.dispose();
        }
    }

    private void validatePdfPageCount(byte[] bytes) {
        try (PDDocument document = Loader.loadPDF(bytes)) {
            if (document.isEncrypted()) {
                throw new IllegalArgumentException("不支持加密PDF，请解除密码后重试");
            }
            if (document.getNumberOfPages() > maxPages) {
                throw new IllegalArgumentException("PDF超过" + maxPages + "页限制");
            }
        } catch (org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException e) {
            throw new IllegalArgumentException("不支持加密PDF，请解除密码后重试", e);
        } catch (IOException e) {
            throw new IllegalArgumentException("PDF已损坏或格式不正确", e);
        }
    }

    private String decodeText(byte[] bytes, List<String> warnings) {
        byte[] value = bytes;
        if (value.length >= 3 && (value[0] & 0xff) == 0xef && (value[1] & 0xff) == 0xbb && (value[2] & 0xff) == 0xbf) {
            value = java.util.Arrays.copyOfRange(value, 3, value.length);
        }
        try {
            CharBuffer decoded = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(value));
            return decoded.toString();
        } catch (CharacterCodingException e) {
            warnings.add("TXT不是UTF-8编码，已按GB18030兼容读取");
            return java.nio.charset.Charset.forName("GB18030").decode(ByteBuffer.wrap(value)).toString();
        }
    }

    private void validateSignature(byte[] bytes, String extension) {
        boolean valid = switch (extension) {
            case ".pdf" -> startsWith(bytes, "%PDF-".getBytes(StandardCharsets.US_ASCII));
            case ".png" -> startsWith(bytes, new byte[]{(byte) 0x89, 0x50, 0x4e, 0x47});
            case ".jpg", ".jpeg" -> startsWith(bytes, new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff});
            case ".webp" -> bytes.length >= 12
                    && startsWith(bytes, "RIFF".getBytes(StandardCharsets.US_ASCII))
                    && new String(bytes, 8, 4, StandardCharsets.US_ASCII).equals("WEBP");
            case ".docx" -> startsWith(bytes, new byte[]{0x50, 0x4b});
            case ".doc" -> startsWith(bytes, new byte[]{(byte) 0xd0, (byte) 0xcf, 0x11, (byte) 0xe0});
            case ".txt" -> true;
            default -> false;
        };
        if (!valid) throw new IllegalArgumentException("文件内容与扩展名不匹配");
    }

    private boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) return false;
        for (int index = 0; index < prefix.length; index++) {
            if (bytes[index] != prefix[index]) return false;
        }
        return true;
    }

    private boolean isCompatibilityIdeograph(int codePoint) {
        return (codePoint >= 0x2F00 && codePoint <= 0x2FDF)
                || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
                || (codePoint >= 0x2F800 && codePoint <= 0x2FA1F);
    }

    private String safeFilename(String original) {
        String filename = original == null || original.isBlank() ? "resume" : original;
        filename = filename.replace('\\', '/');
        int slash = filename.lastIndexOf('/');
        if (slash >= 0) filename = filename.substring(slash + 1);
        return filename.length() > 255 ? filename.substring(filename.length() - 255) : filename;
    }

    private String extensionOf(String filename) {
        int dot = filename.lastIndexOf('.');
        return dot < 0 ? "" : filename.substring(dot).toLowerCase(Locale.ROOT);
    }

    private String mimeForExtension(String extension) {
        return switch (extension) {
            case ".png" -> "image/png";
            case ".webp" -> "image/webp";
            default -> "image/jpeg";
        };
    }

    private String conciseMessage(Throwable error) {
        String message = error == null ? "未知错误" : error.getMessage();
        if (message == null || message.isBlank()) message = error.getClass().getSimpleName();
        return message.length() > 500 ? message.substring(0, 500) : message;
    }

    private String limit(String text) {
        if (text == null) return "";
        return text.length() > maxOutputChars ? text.substring(0, maxOutputChars) : text;
    }

    private enum ParseMode {
        AUTO,
        LOCAL,
        AI_REVIEW;

        static ParseMode from(String raw) {
            if (raw == null || raw.isBlank() || "auto".equalsIgnoreCase(raw)) return AUTO;
            if ("local".equalsIgnoreCase(raw)) return LOCAL;
            if ("ai_review".equalsIgnoreCase(raw)) return AI_REVIEW;
            throw new IllegalArgumentException("mode仅支持 auto、local 或 ai_review");
        }
    }
}
