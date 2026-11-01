import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AlertCircle, Calendar, Clock, Link2, MessageSquare, Tag, UserRound } from 'lucide-react'
import type { Member, Task, TaskComment, TaskPriority, TaskStatus } from '@/types'
import {
  AVAILABLE_TAGS,
  COLUMNS,
  PRIORITY_COLORS,
  STATUS_COLORS,
  TAG_COLORS,
} from '@/types'
import { cn } from '@/lib/utils'

interface TaskDetailDialogProps {
  task: Task | null
  open: boolean
  members: Member[]
  allTasks: Task[]
  onOpenChange: (open: boolean) => void
  onSave: (task: Task) => void
  onAddComment: (taskId: string, comment: TaskComment) => void
  onLinkTask: (taskId: string, relatedId: string) => void
}

interface TaskDetailDialogContentProps {
  task: Task
  members: Member[]
  allTasks: Task[]
  onOpenChange: (open: boolean) => void
  onSave: (task: Task) => void
  onAddComment: (taskId: string, comment: TaskComment) => void
  onLinkTask: (taskId: string, relatedId: string) => void
}

interface TaskFormData {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee: string
  dueDate: string
  tags: string[]
  estimatedHours: string
}

type TaskFormErrors = Partial<Record<'title' | 'description' | 'assignee' | 'estimatedHours', string>>

const STATUS_LABELS: Record<TaskStatus, string> = Object.fromEntries(
  COLUMNS.map((column) => [column.id, column.label])
) as Record<TaskStatus, string>

function createFormData(task: Task | null): TaskFormData {
  if (!task) {
    return {
      title: '',
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee: '',
      dueDate: '',
      tags: [],
      estimatedHours: '',
    }
  }

  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    dueDate: task.dueDate ?? '',
    tags: task.tags ?? [],
    estimatedHours: task.estimatedHours?.toString() ?? '',
  }
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function TaskDetailDialog({
  task,
  open,
  members,
  allTasks,
  onOpenChange,
  onSave,
  onAddComment,
  onLinkTask,
}: TaskDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {task && (
        <TaskDetailDialogContent
          key={task.id}
          task={task}
          members={members}
          allTasks={allTasks}
          onOpenChange={onOpenChange}
          onSave={onSave}
          onAddComment={onAddComment}
          onLinkTask={onLinkTask}
        />
      )}
    </Dialog>
  )
}

function TaskDetailDialogContent({
  task,
  members,
  allTasks,
  onOpenChange,
  onSave,
  onAddComment,
  onLinkTask,
}: TaskDetailDialogContentProps) {
  const [data, setData] = useState<TaskFormData>(() => createFormData(task))
  const [errors, setErrors] = useState<TaskFormErrors>({})
  const [commentDraft, setCommentDraft] = useState('')
  const [commentRecipient, setCommentRecipient] = useState('')
  const [relatedDraft, setRelatedDraft] = useState('')
  const contentRef = useRef<HTMLDivElement | null>(null)

  const comments = task.comments ?? []
  const relatedTasks = allTasks.filter((t) => (task.relatedTo ?? []).includes(t.id))
  const linkableTasks = allTasks.filter(
    (t) => t.id !== task.id && !(task.relatedTo ?? []).includes(t.id),
  )

  const postComment = () => {
    const body = commentDraft.trim()
    if (!body) return
    onAddComment(task.id, {
      id: `comment-${Date.now()}`,
      body,
      recipient: commentRecipient || undefined,
      createdAt: new Date().toISOString(),
    })
    setCommentDraft('')
  }

  const linkRelated = (relatedId: string) => {
    setRelatedDraft('')
    if (relatedId) onLinkTask(task.id, relatedId)
  }

  const selectableMembers = members.filter(
    (member) => member.status === 'active' || member.name === data.assignee
  )

  const validate = () => {
    const newErrors: TaskFormErrors = {}

    if (!data.title.trim()) newErrors.title = 'Task name is required'
    if (!data.description.trim()) newErrors.description = 'Description is required'
    if (!data.assignee) newErrors.assignee = 'Please select an assignee'
    if (
      data.estimatedHours &&
      (Number.isNaN(Number(data.estimatedHours)) || Number(data.estimatedHours) < 0)
    ) {
      newErrors.estimatedHours = 'Must be a positive number'
    }
    if (data.estimatedHours && Number(data.estimatedHours) > 999) {
      newErrors.estimatedHours = 'Must be under 1000 hours'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const toggleTag = (tag: string) => {
    setData((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((item) => item !== tag) : [...prev.tags, tag],
    }))
  }

  const handleSave = () => {
    if (!validate()) return

    const nextTask: Task = {
      ...task,
      title: data.title.trim(),
      description: data.description.trim(),
      status: data.status,
      priority: data.priority,
      assignee: data.assignee,
    }

    if (data.dueDate) nextTask.dueDate = data.dueDate
    else delete nextTask.dueDate

    if (data.tags.length > 0) nextTask.tags = [...data.tags]
    else delete nextTask.tags

    if (data.estimatedHours && Number(data.estimatedHours) > 0) {
      nextTask.estimatedHours = Number(data.estimatedHours)
    } else {
      delete nextTask.estimatedHours
    }

    onSave(nextTask)
    onOpenChange(false)
  }

  return (
    <DialogContent
      ref={contentRef}
      className="sm:max-w-[720px]"
      closeButtonTestId="task-detail-close-button"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        contentRef.current?.focus()
      }}
    >
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
          <DialogDescription>
            Review the task context and edit the fields below.
          </DialogDescription>
        </DialogHeader>

        {task && (
          <div className="space-y-5">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Task Overview
                  </p>
                  <h3 className="text-lg font-semibold leading-tight">
                    {data.title.trim() || 'Untitled task'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {task.id} · Created {new Date(task.createdAt).toLocaleDateString('en-US')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className={cn(STATUS_COLORS[data.status], 'text-xs')}>
                    {STATUS_LABELS[data.status]}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn('text-xs capitalize', PRIORITY_COLORS[data.priority])}
                  >
                    {data.priority}
                  </Badge>
                </div>
              </div>

              <p className="mt-3 text-sm text-muted-foreground">
                {data.description.trim() || 'Add a description to explain the task context.'}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  <UserRound className="h-3.5 w-3.5" />
                  {data.assignee || 'Unassigned'}
                </span>
                {data.dueDate && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(data.dueDate)}
                  </span>
                )}
                {data.estimatedHours && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {data.estimatedHours}h estimate
                  </span>
                )}
              </div>

              {data.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className={cn('text-xs', TAG_COLORS[tag])}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="task-detail-title">
                  Task Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="task-detail-title"
                  value={data.title}
                  onChange={(e) => {
                    setData((prev) => ({ ...prev, title: e.target.value }))
                    if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }))
                  }}
                  className={errors.title ? 'border-destructive' : ''}
                />
                {errors.title && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.title}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-detail-assignee">
                  Assignee <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={data.assignee}
                  onValueChange={(value) => {
                    setData((prev) => ({ ...prev, assignee: value }))
                    if (errors.assignee) setErrors((prev) => ({ ...prev, assignee: undefined }))
                  }}
                >
                  <SelectTrigger
                    id="task-detail-assignee"
                    className={errors.assignee ? 'border-destructive' : ''}
                  >
                    <SelectValue placeholder="Select a team member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableMembers.map((member) => (
                      <SelectItem key={member.id} value={member.name}>
                        {member.name} ({member.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.assignee && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.assignee}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="task-detail-status">Status</Label>
                <Select
                  value={data.status}
                  onValueChange={(value) =>
                    setData((prev) => ({ ...prev, status: value as TaskStatus }))
                  }
                >
                  <SelectTrigger id="task-detail-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map((column) => (
                      <SelectItem key={column.id} value={column.id}>
                        {column.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-detail-priority">Priority</Label>
                <Select
                  value={data.priority}
                  onValueChange={(value) =>
                    setData((prev) => ({ ...prev, priority: value as TaskPriority }))
                  }
                >
                  <SelectTrigger id="task-detail-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-detail-due-date">Due Date</Label>
                <Input
                  id="task-detail-due-date"
                  type="date"
                  value={data.dueDate}
                  onChange={(e) => setData((prev) => ({ ...prev, dueDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-detail-description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="task-detail-description"
                rows={4}
                value={data.description}
                onChange={(e) => {
                  setData((prev) => ({ ...prev, description: e.target.value }))
                  if (errors.description) {
                    setErrors((prev) => ({ ...prev, description: undefined }))
                  }
                }}
                className={errors.description ? 'border-destructive' : ''}
              />
              {errors.description && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {errors.description}
                </p>
              )}
            </div>

            {/* Comments / opinion thread */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                Comments / Opinions
              </Label>

              {comments.length > 0 && (
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div
                      key={comment.id}
                      data-agrune-demo="task-detail-comment"
                      data-comment-id={comment.id}
                      className="rounded-md border bg-muted/20 p-2.5 text-sm"
                    >
                      {comment.recipient && (
                        <p className="text-xs font-medium text-primary mb-0.5">@{comment.recipient}</p>
                      )}
                      <p className="text-foreground whitespace-pre-wrap">{comment.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(comment.createdAt).toLocaleString('en-US')}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="space-y-1">
                  <Label htmlFor="task-detail-comment-author" className="text-xs text-muted-foreground">
                    Addressed to
                  </Label>
                  <Select value={commentRecipient} onValueChange={setCommentRecipient}>
                    <SelectTrigger id="task-detail-comment-author">
                      <SelectValue placeholder="Anyone" />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((member) => (
                        <SelectItem key={member.id} value={member.name}>
                          {member.name} ({member.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="task-detail-comment" className="text-xs text-muted-foreground">
                    Comment
                  </Label>
                  <Textarea
                    id="task-detail-comment"
                    rows={2}
                    placeholder="Ask for an opinion or leave a note..."
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="task-detail-add-comment"
                  onClick={postComment}
                  disabled={!commentDraft.trim()}
                >
                  Post Comment
                </Button>
              </div>
            </div>

            {/* Related / follow-up tickets */}
            <div className="space-y-2">
              <Label htmlFor="task-detail-related" className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Related Tickets
              </Label>
              {relatedTasks.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {relatedTasks.map((t) => (
                    <Badge
                      key={t.id}
                      variant="outline"
                      data-agrune-demo="task-detail-related-item"
                      data-related-id={t.id}
                      className="text-xs"
                    >
                      {t.title}
                    </Badge>
                  ))}
                </div>
              )}
              <Select value={relatedDraft} onValueChange={linkRelated}>
                <SelectTrigger id="task-detail-related" className="sm:max-w-sm">
                  <SelectValue placeholder="Link a related ticket..." />
                </SelectTrigger>
                <SelectContent>
                  {linkableTasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  Tags / Labels
                </Label>
                <div className="flex min-h-[42px] flex-wrap gap-2 rounded-md border bg-muted/20 p-3">
                  {AVAILABLE_TAGS.map((tag) => {
                    const isSelected = data.tags.includes(tag)

                    return (
                      <button
                        key={tag}
                        type="button"
                        data-agrune-demo="task-detail-tag"
                        data-tag={tag}
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all',
                          isSelected
                            ? cn(TAG_COLORS[tag], 'ring-1 ring-primary/30 ring-offset-1')
                            : 'border-border bg-background text-muted-foreground hover:bg-muted',
                        )}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="task-detail-hours" className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Est. Hours
                </Label>
                <Input
                  id="task-detail-hours"
                  type="number"
                  min="0"
                  max="999"
                  step="0.5"
                  placeholder="e.g. 8"
                  value={data.estimatedHours}
                  onChange={(e) => {
                    setData((prev) => ({ ...prev, estimatedHours: e.target.value }))
                    if (errors.estimatedHours) {
                      setErrors((prev) => ({ ...prev, estimatedHours: undefined }))
                    }
                  }}
                  className={errors.estimatedHours ? 'border-destructive' : ''}
                />
                {errors.estimatedHours && (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.estimatedHours}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="task-detail-cancel-button"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="task-detail-save-button">
            Save Changes
          </Button>
        </DialogFooter>
    </DialogContent>
  )
}
