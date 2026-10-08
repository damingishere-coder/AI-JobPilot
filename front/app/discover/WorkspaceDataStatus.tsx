import { Button } from '@/components/ui/button'

export function workspaceCountLabel(total: number, loading: boolean, loaded: boolean, error?: string) {
  if (loading) return '读取中…'
  if (!loaded) return error ? '读取失败' : '读取中…'
  return `${error ? '上次记录：' : ''}共 ${total} 条`
}

export function WorkspaceDataStatus({ loading, error, updatedAt, hasData, onRetry }: { loading: boolean; error?: string; updatedAt?: number | null; hasData: boolean; onRetry: () => void }) {
  return <div className="space-y-2">
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">{error} {hasData && <span>当前显示上次成功加载的记录。</span>} <Button size="sm" variant="outline" onClick={onRetry}>重新加载</Button></div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">正在更新岗位结果…</p>}
    {updatedAt && <p className="text-xs text-muted-foreground">最近更新：{new Date(updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</p>}
  </div>
}

export async function readWorkspaceResponse<T>(response: Response, label: string): Promise<T> {
  const data = await response.json().catch(() => { throw new Error(`${label}返回异常，请重试。`) })
  if (!response.ok || data?.success === false) throw new Error(data?.message || `${label}失败（HTTP ${response.status}）`)
  if (!data || typeof data !== 'object') throw new Error(`${label}格式异常，请检查服务版本。`)
  return data as T
}
