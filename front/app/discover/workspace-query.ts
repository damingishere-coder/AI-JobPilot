export type DiscoverPlatform = 'boss' | 'zhilian'
export type DiscoverView = 'setup' | 'task' | 'results'

export function readWorkspaceQuery(params: URLSearchParams) {
  const platform: DiscoverPlatform = params.get('platform') === 'zhilian' ? 'zhilian' : 'boss'
  const rawView = params.get('view')
  const view: DiscoverView = rawView === 'task' || rawView === 'results' ? rawView : 'setup'
  return { platform, view, scanRunId: params.get('scanRunId') || '' }
}

/** Keep legacy scope and return parameters when changing a workspace view. */
export function workspaceHref(params: URLSearchParams, platform: DiscoverPlatform, view: DiscoverView) {
  const next = new URLSearchParams(params)
  if (next.get('platform') && next.get('platform') !== platform) {
    next.delete('scanRunId')
  }
  next.set('platform', platform)
  next.set('view', view)
  return `/discover?${next.toString()}`
}
