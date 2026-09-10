package com.getjobs.application.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;

@Service
public class HrAssistantCryptoService {
    private static final String PREFIX = "v1:";
    private static final int KEY_BYTES = 32;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final Path keyPath;
    private final SecureRandom secureRandom = new SecureRandom();
    private volatile SecretKey cachedKey;

    @Autowired
    public HrAssistantCryptoService(@Value("${app.hr-assistant.key-path:}") String configuredPath) {
        this(resolveDefaultPath(configuredPath));
    }

    HrAssistantCryptoService(Path keyPath) {
        this.keyPath = keyPath.toAbsolutePath().normalize();
    }

    public String encrypt(String plaintext, String associatedData) {
        if (plaintext == null) return null;
        try {
            byte[] iv = new byte[IV_BYTES];
            secureRandom.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(normalizeAad(associatedData));
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            return PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(iv) + ":" +
                    Base64.getUrlEncoder().withoutPadding().encodeToString(ciphertext);
        } catch (GeneralSecurityException | IOException e) {
            throw new IllegalStateException("HR 助手敏感数据加密失败", e);
        }
    }

    public String decrypt(String encoded, String associatedData) {
        if (encoded == null || encoded.isBlank()) return "";
        if (!encoded.startsWith(PREFIX)) {
            throw new IllegalStateException("HR 助手敏感字段不是受支持的密文格式");
        }
        String[] parts = encoded.substring(PREFIX.length()).split(":", 2);
        if (parts.length != 2) throw new IllegalStateException("HR 助手密文格式损坏");
        try {
            byte[] iv = Base64.getUrlDecoder().decode(parts[0]);
            byte[] ciphertext = Base64.getUrlDecoder().decode(parts[1]);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(normalizeAad(associatedData));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IOException | IllegalArgumentException e) {
            throw new IllegalStateException("HR 助手敏感数据解密失败，已停止继续处理", e);
        }
    }

    public String blindIndex(String value, String context) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key());
            mac.update(normalizeAad(context));
            mac.update((byte) 0);
            return HexFormat.of().formatHex(mac.doFinal((value == null ? "" : value).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException | IOException e) {
            throw new IllegalStateException("无法计算 HR 助手安全索引", e);
        }
    }

    Path keyPath() {
        return keyPath;
    }

    private SecretKey key() throws IOException {
        SecretKey current = cachedKey;
        if (current != null) return current;
        synchronized (this) {
            if (cachedKey != null) return cachedKey;
            Files.createDirectories(keyPath.getParent());
            byte[] raw;
            if (Files.exists(keyPath)) {
                raw = Base64.getDecoder().decode(Files.readString(keyPath, StandardCharsets.US_ASCII).trim());
                if (raw.length != KEY_BYTES) throw new IOException("密钥长度无效");
            } else {
                raw = new byte[KEY_BYTES];
                secureRandom.nextBytes(raw);
                try {
                    Files.writeString(keyPath, Base64.getEncoder().encodeToString(raw), StandardCharsets.US_ASCII,
                            StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
                } catch (java.nio.file.FileAlreadyExistsException race) {
                    raw = Base64.getDecoder().decode(Files.readString(keyPath, StandardCharsets.US_ASCII).trim());
                }
            }
            if (raw.length != KEY_BYTES) throw new IOException("密钥长度无效");
            restrictToCurrentUser(keyPath);
            cachedKey = new SecretKeySpec(raw, "AES");
            return cachedKey;
        }
    }

    private void restrictToCurrentUser(Path path) throws IOException {
        var posix = Files.getFileAttributeView(path, java.nio.file.attribute.PosixFileAttributeView.class);
        if (posix != null) {
            Files.setPosixFilePermissions(path, Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
            return;
        }
        AclFileAttributeView acl = Files.getFileAttributeView(path, AclFileAttributeView.class);
        if (acl == null) throw new IOException("当前文件系统不支持用户级密钥权限");
        var owner = Files.getOwner(path);
        AclEntry entry = AclEntry.newBuilder()
                .setType(AclEntryType.ALLOW)
                .setPrincipal(owner)
                .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                .build();
        acl.setAcl(List.of(entry));
    }

    private byte[] normalizeAad(String associatedData) {
        return (associatedData == null ? "" : associatedData).getBytes(StandardCharsets.UTF_8);
    }

    private static Path resolveDefaultPath(String configuredPath) {
        if (configuredPath != null && !configuredPath.isBlank()) return Path.of(configuredPath.trim());
        String localAppData = System.getenv("LOCALAPPDATA");
        if (localAppData != null && !localAppData.isBlank()) {
            return Path.of(localAppData, "AI-JobPilot", "secrets", "hr-chat.key");
        }
        return Path.of(System.getProperty("user.home"), ".ai-jobpilot", "secrets", "hr-chat.key");
    }
}
