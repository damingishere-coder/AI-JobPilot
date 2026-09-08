export type FilterNode = { code: string; name: string; children: FilterNode[] }
export type ZhilianFilters = {
  district?: string; subwayLine?: string; subwayStation?: string;
  education?: string[]; experience?: string[]; companyType?: string[]; financing?: string[];
  companySize?: string[]; workNature?: string[]; jobCategory?: string; industry?: string[];
}
export type FilterCatalog = { source: string; version: string; cityCode: string; cityName: string; options: Record<string, FilterNode[]> }
export const MULTI_FILTERS = [
  ['education','学历'],['experience','经验'],['companyType','公司性质'],
  ['financing','融资阶段'],['companySize','公司人数'],['workNature','工作性质'],
] as const
export function resetCityFilters(filters: ZhilianFilters = {}): ZhilianFilters {
  return {...filters,district:'',subwayLine:'',subwayStation:''}
}
export function findFilterPath(nodes: FilterNode[], code: string): FilterNode[] {
  for (const node of nodes) {
    if (node.code === code) return [node]
    const path = findFilterPath(node.children || [], code)
    if (path.length) return [node,...path]
  }
  return []
}
