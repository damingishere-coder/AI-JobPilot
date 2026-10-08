package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** Conversational checks supplement the model's factual and semantic audit. */
public final class HrConversationPolicy {
    public static final String INSTRUCTIONS = """
            对话规则：
            - 先回应 HR 当前这一轮，按对方的语气自然交流，通常一两句、20–60字；复杂问题可以展开，不为凑字数添加内容。
            - 仅打招呼或问是否在线时，简短回应即可，例如“你好，我在。”；不主动介绍经历、筛选岗位或询问职责、薪资、地点。
            - 先回答本轮连续多条问题，再判断是否确有一个影响当前交流的未知信息；有必要才追问一个问题。
            - 对照本人之前的消息和 HR 已给出的信息，禁止重复追问、换一种说法再问、催回复或因对方未回而继续发送。
            - 婉拒、暂无合适岗位或人才库通知，仅回复“好的，谢谢”后结束；不补充经历、争取机会或追问原因。
            - 本轮只有“好的”“收到”“谢谢”等结束语且没有未解决请求时，classification=NO_REPLY，replyText为空。
            - 避免反复“您好”、简历式自我介绍及“期待进一步沟通”“业务场景梳理”等空泛套话。
            - 普通寒暄、致谢和愿意了解岗位是沟通表达，不是简历事实；涉及经历、数字、地点、薪资、在职状态、时间和承诺仍必须有已确认资料。
            示例只说明说话方式，不是求职者事实：HR“你好”→“你好，我在。”；HR“方便聊聊吗”→“可以，你说。”；
            HR“谢谢”且本轮无其他问题→NO_REPLY；HR“这个岗位不太合适”→“好的，谢谢”。
            """;

    private static final Pattern GREETING = Pattern.compile(
            "(?i)(?:你好|您好|哈喽|嗨|hi|hello|在吗|在么|在不在|你在吗|您在吗|"
                    + "(?:现在)?(?:方便|可以)(?:简单)?(?:聊聊|聊几句|沟通)(?:吗|么)?)");
    private static final Pattern CLOSING = Pattern.compile(
            "(?:好呀|好啊|好哦|好的|好|嗯|收到啦|收到|明白了|明白|了解了|了解|"
                    + "谢谢你|谢谢您|谢谢|感谢你|感谢您|感谢|辛苦你了|辛苦您了|辛苦了)");
    private static final Pattern COURTESY = Pattern.compile(
            "(?i)(?:你好|您好|哈喽|嗨|hi|hello|好|好的|好呀|好啊|好哦|嗯|嗯嗯|"
                    + "(?:我)?在(?:的|呢)?|我在这|收到(?:啦|了)?|明白(?:了)?|了解(?:了)?|"
                    + "谢谢(?:你|您)?(?:的)?(?:回复|反馈|介绍|说明|转交)?|"
                    + "感谢(?:你|您)?(?:的)?(?:回复|反馈|介绍|说明|转交)?|辛苦(?:你|您)?了|"
                    + "可以|可以的|方便|方便的|可以聊聊|你说|您说|请说|"
                    + "愿意(?:进一步)?沟通|可以先(?:沟通|聊聊)(?:了解)?|"
                    + "愿意了解这个岗位|期待进一步沟通|结合职责面议)");
    private static final Pattern QUESTION = Pattern.compile(
            "[?？]|请问|想了解|想问|能否|可否|是否|什么|怎么|怎样|哪里|哪[个里些]|多少|几[天年个月]|[吗么][，,。；;]?$");

    private HrConversationPolicy() { }

    public static boolean closingRound(ChatCapture capture) {
        return capture.messages().stream().anyMatch(m -> "本人".equals(m.from()))
                && plainRoundMatches(capture, CLOSING);
    }

    public static boolean courtesy(String clause) {
        return COURTESY.matcher(normalize(clause)).matches();
    }

    /** Pure questions may contain no personal assertions; the model still audits necessity and meaning. */
    public static boolean jobQuestion(String clause) {
        String value = normalize(clause);
        return value.matches("(?:请问|(?:我)?想(?:了解|问)(?:一下|下)?|(?:方便|能否)(?:介绍|说)(?:一下|下)?)?"
                + "(?:这个|该|这边)?(?:岗位|日常工作)?(?:主要|具体|日常)?"
                + "(?:(?:岗位职责|工作内容|工作地点|待遇|薪资|岗位详情)(?:是什么|有哪些|在哪里|在哪|多少)?"
                + "|(?:负责|做)(?:什么|哪些业务)|在哪里|在哪)");
    }

    public static String violation(ChatCapture capture, String candidate) {
        if (capture.messages().isEmpty() || !capture.messages().getLast().inbound())
            return "对方没有新的待回复消息，禁止主动催促";
        var acknowledgment = HrDeclineAcknowledgment.draft(capture);
        if (acknowledgment != null && !HrDeclineAcknowledgment.REPLY.equals(candidate.strip()))
            return "本轮仅为婉拒或后续联系通知，只能礼貌致谢后结束";
        if (plainRoundMatches(capture, GREETING)) {
            for (String part : candidate.split("[，,。！？!?；;\\r\\n]+"))
                if (!part.isBlank() && !courtesy(part))
                    return "简单招呼只需简短回应，不追加介绍或岗位追问";
        }
        List<String> questions = questions(candidate);
        if (questions.size() > 1) return "本轮追加了多个追问，只能问一个必要问题";
        for (ChatMessage message : capture.messages()) {
            if (!"本人".equals(message.from())) continue;
            for (String previous : questions(message.text()))
                for (String question : questions)
                    if (questionKey(previous).equals(questionKey(question)))
                        return "该问题本人已经问过，禁止重复追问";
        }
        return "";
    }

    private static boolean plainRoundMatches(ChatCapture capture, Pattern pattern) {
        if (!HrMediaService.complete(capture) || capture.messages().isEmpty()
                || !capture.messages().getLast().inbound()) return false;
        int first = capture.messages().size() - 1;
        while (first > 0 && capture.messages().get(first - 1).inbound()) first--;
        boolean content = false;
        for (ChatMessage message : capture.messages().subList(first, capture.messages().size())) {
            if (!"文本".equals(message.type()) || !message.media().isEmpty()) return false;
            String value = normalize(message.text());
            if (value.isEmpty() || !matchesTokens(value, pattern)) return false;
            content = true;
        }
        return content;
    }

    /** Consume tokens once, avoiding exponential backtracking on overlapping courtesy words. */
    private static boolean matchesTokens(String value, Pattern pattern) {
        var matcher = pattern.matcher(value);
        int offset = 0;
        while (offset < value.length()) {
            if (!matcher.region(offset, value.length()).lookingAt()) return false;
            offset = matcher.end();
        }
        return true;
    }

    private static List<String> questions(String text) {
        List<String> result = new ArrayList<>();
        if (text == null) return result;
        for (String part : text.split("(?<=[。！？!?；;\\n])")) {
            String value = part.strip();
            if (normalize(value).matches("请问|想问|想了解")) continue;
            if (QUESTION.matcher(value).find()) result.add(value);
        }
        return result;
    }

    private static String questionKey(String text) {
        return normalize(text).replaceFirst("^(?:(?:你好|您好|请问|想问|想了解|方便介绍|能否介绍))+", "")
                .replaceFirst("(?:吗|么|呢)$", "");
    }

    private static String normalize(String value) {
        return value == null ? "" : value.replaceAll("[\\s\\p{Punct}，。！？；：“”‘’、]+", "")
                .toLowerCase(Locale.ROOT);
    }
}
