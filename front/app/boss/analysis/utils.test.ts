import { describe, expect, it } from "vitest"

import { formatAiReasonDetail, parseAiReason, riskTextOf } from "./utils"

describe("AI岗位理由兼容解析", () => {
  it("解析 schemaVersion 2 的证据、待核实和分项得分", () => {
    const reason = JSON.stringify({
      schemaVersion: 2,
      summary: "核心技能匹配，地点需要确认",
      matches: ["岗位要求 Java，简历写有 Java"],
      gaps: ["岗位要求带团队，简历仅描述个人贡献"],
      unknowns: ["未写明到岗时间"],
      dimensions: [{
        key: "CORE_SKILLS",
        label: "核心职责与技能",
        weight: 35,
        status: "MATCH",
        awarded: 35,
        jobEvidence: ["Java"],
        resumeEvidence: ["Java"],
        note: "技术栈一致",
      }],
      hardConflicts: [],
      threshold: 75,
      errorCode: null,
    })

    const parsed = parseAiReason(reason)

    expect(parsed.schemaVersion).toBe(2)
    expect(parsed.matches).toEqual(["岗位要求 Java，简历写有 Java"])
    expect(parsed.unknowns).toEqual(["未写明到岗时间"])
    const detail = formatAiReasonDetail(reason)
    expect(detail).toContain("结论")
    expect(detail).toContain("匹配证据")
    expect(detail).toContain("明确差距")
    expect(detail).toContain("待核实")
    expect(detail).toContain("分项得分")
  })

  it("兼容旧版 JSON 并把 strengths/risks 映射为匹配和差距", () => {
    const parsed = parseAiReason(JSON.stringify({
      summary: "旧版结论",
      strengths: ["Java经验"],
      risks: ["学历待确认"],
      threshold: 75,
    }))

    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.matches).toEqual(["Java经验"])
    expect(parsed.gaps).toEqual(["学历待确认"])
  })

  it("兼容历史纯文本且不把损坏 JSON 原文显示给用户", () => {
    expect(parseAiReason("升级前任务上下文已丢失").summary).toBe("升级前任务上下文已丢失")
    const malformed = parseAiReason('{"summary":')
    expect(malformed.malformed).toBe(true)
    expect(malformed.summary).toBe("AI分析理由格式异常，请重试该岗位")
    expect(malformed.summary).not.toContain('{"summary"')
  })

  it("风险摘要只展示差距和待核实，不重复整段理由", () => {
    const aiReason = JSON.stringify({
      schemaVersion: 2,
      summary: "总体匹配",
      matches: ["技能匹配"],
      gaps: ["管理经验不足"],
      unknowns: ["薪资待确认"],
      dimensions: [],
      hardConflicts: [],
    })

    expect(riskTextOf({ id: 1, aiReason, jobUrl: "https://example.com" }))
      .toBe("管理经验不足\n待核实：薪资待确认")
  })

  it("没有单独 gaps 时仍展示分项中的部分匹配和冲突", () => {
    const aiReason = JSON.stringify({
      schemaVersion: 2,
      summary: "需要复核经验与地点",
      matches: [],
      gaps: [],
      unknowns: [],
      dimensions: [
        { key: "RELEVANT_EXPERIENCE", label: "相关经历", status: "PARTIAL", note: "经验方向接近" },
        { key: "LOCATION_SALARY", label: "地点与薪资", status: "CONFLICT", note: "地点明确不符" },
      ],
      hardConflicts: [],
    })

    expect(riskTextOf({ id: 1, aiReason, jobUrl: "https://example.com" }))
      .toBe("相关经历：经验方向接近\n地点与薪资：地点明确不符")
  })
})
