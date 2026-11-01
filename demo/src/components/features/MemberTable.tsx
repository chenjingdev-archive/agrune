import { useState, useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronLeft, ChevronRight, MessageSquare, Plus, Search, Users } from 'lucide-react'
import type { Member } from '@/types'
import { ROLE_COLORS } from '@/types'
import { cn } from '@/lib/utils'
import { useLocalStorage } from '@/hooks/useLocalStorage'

interface MemberTableProps {
  members: Member[]
  onCreateTicket: (member: Member) => void
  onMessageMember: (member: Member) => void
}

const PAGE_SIZE_OPTIONS = [5, 10] as const

export function MemberTable({ members, onCreateTicket, onMessageMember }: MemberTableProps) {
  const [search, setSearch] = useLocalStorage<string>('pm-member-search', '')
  const [roleFilter, setRoleFilter] = useLocalStorage<string>('pm-member-role-filter', 'all')
  const [statusFilter, setStatusFilter] = useLocalStorage<string>('pm-member-status-filter', 'all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useLocalStorage<number>('pm-member-page-size', 5)

  const filteredMembers = useMemo(() => {
    let result = members

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.skills ?? []).some((s) => s.toLowerCase().includes(q)) ||
          (m.department ?? '').toLowerCase().includes(q)
      )
    }

    if (roleFilter !== 'all') {
      result = result.filter((m) => m.role === roleFilter)
    }

    if (statusFilter !== 'all') {
      result = result.filter((m) => m.status === statusFilter)
    }

    return result
  }, [members, search, roleFilter, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredMembers.length / pageSize))
  const currentPage = Math.min(page, totalPages - 1)
  const paginatedMembers = filteredMembers.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  )

  // Reset page when filters change
  const handleSearchChange = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  const handleRoleFilterChange = (value: string) => {
    setRoleFilter(value)
    setPage(0)
  }

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value)
    setPage(0)
  }

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value))
    setPage(0)
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6" />
          Team Members
        </h2>
        <p className="text-muted-foreground">
          Manage your team members. Use filters and search to find specific members.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="member-search-input"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={roleFilter} onValueChange={handleRoleFilterChange}>
          <SelectTrigger className="w-[140px]" data-testid="member-role-filter">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="developer">Developer</SelectItem>
            <SelectItem value="designer">Designer</SelectItem>
            <SelectItem value="qa">QA</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
          <SelectTrigger className="w-[140px]" data-testid="member-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground ml-auto">
          {filteredMembers.length} member{filteredMembers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="w-[110px]">Role</TableHead>
              <TableHead>Skills</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[150px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No members found matching your filters.
                </TableCell>
              </TableRow>
            ) : (
              paginatedMembers.map((member) => (
                <TableRow
                  key={member.id}
                  data-agrune-demo="member-row"
                  data-member-id={member.id}
                  data-member-name={member.name}
                  data-member-role={member.role}
                  data-member-status={member.status}
                >
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(ROLE_COLORS[member.role], 'text-xs capitalize')}
                    >
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {(member.skills ?? []).join(', ') || '—'}
                    {member.department && (
                      <span className="block text-[10px] text-muted-foreground/70">{member.department}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={member.status === 'active' ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        data-agrune-demo="member-create-ticket"
                        data-member-id={member.id}
                        aria-label={`Create ticket for ${member.name}`}
                        onClick={() => onCreateTicket(member)}
                      >
                        <Plus className="h-3 w-3" />
                        Ticket
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        data-agrune-demo="member-message"
                        data-member-id={member.id}
                        aria-label={`Message ${member.name}`}
                        onClick={() => onMessageMember(member)}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Showing {filteredMembers.length === 0 ? 0 : currentPage * pageSize + 1} to{' '}
            {Math.min((currentPage + 1) * pageSize, filteredMembers.length)} of{' '}
            {filteredMembers.length}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">Rows:</span>
            <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="w-[70px] h-8" data-testid="member-page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2" data-testid="member-pagination">
          <Button
            variant="outline"
            size="sm"
            data-testid="member-pagination-previous"
            onClick={() => setPage(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => (
              <Button
                key={i}
                data-agrune-demo="member-page-button"
                data-page={i + 1}
                variant={i === currentPage ? 'default' : 'outline'}
                size="sm"
                className="w-8 h-8 p-0"
                onClick={() => setPage(i)}
              >
                {i + 1}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            data-testid="member-pagination-next"
            onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage >= totalPages - 1}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
