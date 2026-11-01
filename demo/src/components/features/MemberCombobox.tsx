import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Member } from '@/types'

interface MemberComboboxProps {
  members: Member[]
  /** selected member NAME ('' = none) */
  value: string
  onChange: (name: string) => void
  /** stable automation hooks */
  triggerTestId: string
  searchId: string
  /** data-agrune-demo value stamped on each option button */
  optionDemo: string
  placeholder?: string
  invalid?: boolean
}

/**
 * Searchable single-select combobox over team members. Unlike a static Radix
 * <Select>, the option list is a transient popover whose contents are filtered at
 * runtime by the search query — so an agent MUST observe the open state to learn
 * which options survive (a "data-driven delta", not a fixed catalog). Picking an
 * option closes the popover and lands the value (an "ack + value" turn).
 */
export function MemberCombobox({
  members,
  value,
  onChange,
  triggerTestId,
  searchId,
  optionDemo,
  placeholder = 'Select a team member...',
  invalid,
}: MemberComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? members.filter((m) => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q))
    : members

  const pick = (m: Member) => {
    onChange(m.name)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        data-testid={triggerTestId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring',
          invalid && 'border-destructive',
          !value && 'text-muted-foreground',
        )}
      >
        <span className="line-clamp-1">{value || placeholder}</span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center gap-2 border-b px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 opacity-50" />
            <input
              id={searchId}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div role="listbox" className="max-h-56 overflow-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No members match “{query}”
              </p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={value === m.name}
                  data-agrune-demo={optionDemo}
                  data-member-id={m.id}
                  onClick={() => pick(m)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    value === m.name && 'bg-accent/50',
                  )}
                >
                  <span>
                    {m.name} <span className="text-muted-foreground">({m.role})</span>
                  </span>
                  {value === m.name && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
