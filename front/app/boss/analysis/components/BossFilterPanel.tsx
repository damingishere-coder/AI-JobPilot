"use client"

import { BiChevronDown, BiChevronUp, BiFilterAlt, BiSearch, BiX } from "react-icons/bi"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  DEGREE_OPTIONS,
  DELIVERY_STATUS_OPTIONS,
  EXPERIENCE_OPTIONS,
  type FilterState,
} from "../types"
import { deliveryStatusLabel } from "../utils"

export function BossFilterPanel({
  filtersOpen,
  activeFilterCount,
  draftFilters,
  itemsLength,
  total,
  onToggleOpen,
  onDraftChange,
  onToggleStatus,
  onApply,
  onReset,
}: {
  filtersOpen: boolean
  activeFilterCount: number
  draftFilters: FilterState
  itemsLength: number
  total: number
  onToggleOpen: () => void
  onDraftChange: (updater: (prev: FilterState) => FilterState) => void
  onToggleStatus: (status: string) => void
  onApply: () => void
  onReset: () => void
}) {
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground"
          onClick={onToggleOpen}
        >
          <BiFilterAlt />
          表头筛选
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{activeFilterCount}</span>
          )}
          {filtersOpen ? <BiChevronUp /> : <BiChevronDown />}
        </button>
        <div className="text-xs text-muted-foreground">
          当前显示 {itemsLength} 条，本页/总数 {total} 条
        </div>
      </div>

      {filtersOpen && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
            <div className="xl:col-span-2">
              <Label className="text-xs">关键词</Label>
              <div className="relative mt-1">
                <BiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={draftFilters.keyword}
                  onChange={(e) => onDraftChange((prev) => ({ ...prev, keyword: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onApply()
                  }}
                  placeholder="公司 / 岗位 / HR"
                  className="h-9 pl-9"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">地点</Label>
              <Input
                value={draftFilters.location}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, location: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApply()
                }}
                placeholder="如 深圳"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label className="text-xs">经验</Label>
              <Select
                value={draftFilters.experience}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, experience: e.target.value }))}
                className="mt-1 h-9 rounded-md bg-background"
              >
                <option value="">全部</option>
                {EXPERIENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">学历</Label>
              <Select
                value={draftFilters.degree}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, degree: e.target.value }))}
                className="mt-1 h-9 rounded-md bg-background"
              >
                <option value="">全部</option>
                {DEGREE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label className="text-xs">月薪(K)</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  type="number"
                  value={draftFilters.minK}
                  onChange={(e) => onDraftChange((prev) => ({ ...prev, minK: e.target.value }))}
                  placeholder="最低"
                  className="h-9"
                />
                <Input
                  type="number"
                  value={draftFilters.maxK}
                  onChange={(e) => onDraftChange((prev) => ({ ...prev, maxK: e.target.value }))}
                  placeholder="最高"
                  className="h-9"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">AI最低分</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={draftFilters.minAiScore}
                onChange={(e) => {
                  const value = e.target.value
                  if (value === "" || (Number(value) >= 0 && Number(value) <= 100)) {
                    onDraftChange((prev) => ({ ...prev, minAiScore: value }))
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApply()
                }}
                placeholder="如 60"
                className="mt-1 h-9"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs text-muted-foreground">投递状态</span>
            {DELIVERY_STATUS_OPTIONS.map((status) => {
              const active = draftFilters.statuses.includes(status)
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => onToggleStatus(status)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-slate-300 bg-background text-foreground hover:border-primary/60 dark:border-slate-700"
                  }`}
                >
                  {deliveryStatusLabel(status)}
                </button>
              )
            })}
            <label className="ml-0 inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-background px-3 py-1 text-xs dark:border-slate-700 md:ml-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={draftFilters.filterHeadhunter}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, filterHeadhunter: e.target.checked }))}
              />
              过滤猎头
            </label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={onReset}>
                <BiX className="mr-1" /> 清空
              </Button>
              <Button size="sm" onClick={onApply}>
                <BiFilterAlt className="mr-1" /> 应用筛选
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
