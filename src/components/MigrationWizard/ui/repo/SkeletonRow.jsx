export function SkeletonRow() {
  return (
    <div className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-3">
        <div className="w-[18px] h-[18px] rounded bg-slate-200 dark:bg-slate-700" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-2 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
        <div className="w-12 h-4 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  )
}
