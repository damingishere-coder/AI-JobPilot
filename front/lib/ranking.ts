export type Preferences = { roles: string[]; cities: string[]; scales: string[]; industries: string[]; workModes: string[]; minSalaryK: number | null; maxSalaryK: number | null; hard: string[] }
export type RankingSettings = { profileId: number; version: number; enabled: boolean; preferences: Preferences }
export type RankedOpportunity = { id: number; jobName: string | null; companyName: string | null; platform: string; analysisId: number | null; legacyScore: number | null; position: number; oldPosition: number;
  fit: { score: number | null; version: string; confidence: string; unknownDimensions: number; hardConflict: boolean };
  preference: { score: number | null; known: number; configured: number; hardTier: number; fields: { key: string; status: string; hard: boolean; reason: string }[] };
  signal: { label: string; direction: number; samples: number; basis: string[] };
}
export type RankingResult = { profileId: number; preferenceVersion: number; enabled: boolean; strategyOrder: boolean; snapshotId: number | null; feedbackState: string; ruleVersion: string; items: RankedOpportunity[] }
export const preferenceFields: Record<string, string> = { ROLE: '岗位方向关键词', CITY: '城市', SCALE: '公司规模', INDUSTRY: '行业关键词', WORK_MODE: '工作方式', SALARY: '期望月薪范围' }
export const signalLabels: Record<string, string> = { FAVORABLE: '有利信号', UNFAVORABLE: '不利信号', MIXED: '混合或相近', INSUFFICIENT_DATA: '样本不足' }
