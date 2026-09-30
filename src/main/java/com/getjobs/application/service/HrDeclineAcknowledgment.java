package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.Classification;

import java.util.List;
import java.util.regex.Pattern;

/** A narrow, deterministic acknowledgment of a fully read, purely closing HR round. */
public final class HrDeclineAcknowledgment {
    public static final String REPLY = "好的，谢谢";
    private static final String YOU = "(?:您|你)";
    private static final String END = "(?:的|哈|呢|哦|了)?";
    private static final String TIME = "(?:暂时|目前|当前|现在)?";
    private static final String EMPLOYER = "(?:我们|我司|本公司)?";
    private static final String SUITABLE = "(?:更)?(?:适合|合适|匹配)(?:(?:您|你)(?:的)?|的)?";
    private static final String CONTACT = EMPLOYER + "(?:会|将)(?:再|及时|第一时间)?(?:与|跟|和)?"
            + YOU + "?联系" + YOU + "?" + END;
    private static final List<Pattern> CLOSING = patterns(
            "(?:(?:很)?(?:遗憾|抱歉)|不好意思|对不起)?" + TIME
                    + "(?:没有|暂无)(?:更)?(?:适合|合适|匹配)(?:(?:您|你)(?:的)?|的)?(?:岗位|职位|机会)" + END,
            "(?:但|但是|不过)?(?:" + YOU + "(?:的)?(?:简历|经历|经验|背景|情况))?"
                    + "(?:与|和|跟)" + EMPLOYER + "(?:当前|目前|现在)?(?:岗位|职位)(?:的)?(?:特定)?(?:需求|要求)?"
                    + "(?:不完全匹配|不太匹配|不够匹配|不匹配|不符合|不完全符合|不符|不合适|不太合适|暂不匹配|暂不符合)" + END,
            "(?:(?:" + YOU + "(?:的)?(?:简历|经历|经验|背景|情况)?)|(?:" + EMPLOYER
                    + "(?:当前|目前)?(?:的)?(?:岗位|职位)))?" + TIME
                    + "(?:不太合适|不合适|不太匹配|不匹配|暂不合适|暂不匹配)" + END,
            EMPLOYER + "(?:会|将|已|已经)?(?:先|暂时)?(?:(?:把|将)?(?:" + YOU + "(?:的)?)?简历)?"
                    + "(?:保留|保存|留存|放入|纳入)(?:在|至|到|进|于)?(?:公司|我们的|我司)?人才库(?:中|里)?" + END,
            "(?:" + YOU + "(?:的)?)?简历(?:会|将|已|已经)?(?:先|暂时)?"
                    + "(?:保留|保存|留存|放入|纳入)(?:在|至|到|进|于)?(?:公司|我们的|我司)?人才库(?:中|里)?" + END,
            "(?:如果|如|若)?(?:后续|之后|以后|未来)?(?:有|出现)?" + SUITABLE
                    + "(?:岗位|职位|机会)(?:的话|时|后)?" + CONTACT,
            "(?:如果|如|若)?(?:后续|之后|以后|未来)?(?:岗位|职位)(?:合适|适合|匹配)(?:的话|时|后)?" + CONTACT,
            "(?:后续|之后|以后)(?:有)?(?:合适的)?机会(?:我们)?(?:会)?再联系" + YOU + "?" + END,
            "(?:目前|当前|现在)?(?:该|这个|本)?(?:岗位|职位)(?:已经|已)?(?:招满|关闭|停止招聘|暂停招聘)" + END
    );
    private static final List<Pattern> COURTESY = patterns(
            "您好|你好|哈喽|嗨",
            "(?:感谢|谢谢)" + YOU + "(?:的)?(?:关注|投递|回复|认可|支持|理解|申请)",
            "(?:很)?(?:遗憾|抱歉)|不好意思|对不起|谢谢|谢谢您|谢谢你|感谢理解",
            YOU + "(?:的)?(?:简历|背景|经历)(?:虽|虽然|很|非常|确实|挺)(?:优秀|不错|出色)",
            "祝" + YOU + "(?:工作顺利|求职顺利|生活愉快|一切顺利)",
            "祝" + YOU + "(?:在(?:BOSS直聘|Boss直聘|boss直聘))?(?:早日)?(?:找到|收获)(?:更)?"
                    + "(?:适合|合适|满意|心仪)(?:(?:您|你)(?:的)?|的)?(?:机会|岗位|工作)"
    );

    private HrDeclineAcknowledgment() { }

    /** Unknown clauses and mixed requests deliberately fall back to the ordinary draft path. */
    public static AiDraft draft(ChatCapture capture) {
        if (capture == null || !HrMediaService.complete(capture) || capture.messages().isEmpty()
                || !capture.messages().getLast().inbound()) return null;
        boolean closing = false;
        int first = capture.messages().size() - 1;
        while (first > 0 && capture.messages().get(first - 1).inbound()) first--;
        for (int i = first; i < capture.messages().size(); i++) {
            var message = capture.messages().get(i);
            if (!"文本".equals(message.type()) || !message.media().isEmpty() || message.text() == null
                    || message.text().contains("?") || message.text().contains("？")) return null;
            boolean content = false;
            for (String part : message.text().split("[，,。.!！；;：:\\r\\n]+")) {
                String clause = part.replaceAll("\\s+", "")
                        .replaceAll("^[\"'“”‘’「」『』]+|[\"'“”‘’「」『』]+$", "");
                if (clause.isEmpty()) continue;
                content = true;
                if (matches(CLOSING, clause)) closing = true;
                else if (!matches(COURTESY, clause)) return null;
            }
            if (!content) return null;
        }
        return closing ? new AiDraft(Classification.REPLY, REPLY,
                "本轮仅为婉拒、后续联系或人才库通知；按本人规则礼貌致谢，不继续争取", List.of(), List.of(), 1) : null;
    }

    private static boolean matches(List<Pattern> patterns, String clause) {
        return patterns.stream().anyMatch(pattern -> pattern.matcher(clause).matches());
    }

    private static List<Pattern> patterns(String... expressions) {
        return List.of(expressions).stream().map(Pattern::compile).toList();
    }
}
