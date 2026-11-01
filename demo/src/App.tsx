import { useCallback, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KanbanBoard } from '@/components/features/KanbanBoard'
import { TaskWizard } from '@/components/features/TaskWizard'
import { MemberTable } from '@/components/features/MemberTable'
import { DocumentViewer } from '@/components/features/DocumentViewer'
import { Messenger } from '@/components/features/Messenger'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { SEED_TASKS, SEED_MEMBERS, SEED_MESSAGES } from '@/seed-data'
import { LayoutDashboard, KanbanSquare, Users, FileText, Workflow, MessageSquare } from 'lucide-react'
import { WorkflowEditor } from '@/components/features/WorkflowEditor'
import { SEED_WORKFLOW_NODES, SEED_WORKFLOW_EDGES } from '@/seed-data'
import type { Task, Member, ChatMessage } from '@/types'

function App() {
  const [tasks, setTasks] = useLocalStorage<Task[]>('pm-tasks', SEED_TASKS)
  const [members] = useLocalStorage<Member[]>('pm-members', SEED_MEMBERS)
  const [messages, setMessages] = useLocalStorage<Record<string, ChatMessage[]>>('pm-messages', SEED_MESSAGES)
  const [wizardOpen, setWizardOpen] = useLocalStorage<boolean>('pm-wizard-open', false)
  const [activeTab, setActiveTab] = useLocalStorage<string>('pm-active-tab', 'board')
  const [wizardPrefillAssignee, setWizardPrefillAssignee] = useState<string>('')
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)

  const handleNewTask = useCallback(
    (taskData: Omit<Task, 'id' | 'order' | 'createdAt'>) => {
      const columnTasks = tasks.filter((t) => t.status === taskData.status)
      const maxOrder = columnTasks.reduce((max, t) => Math.max(max, t.order), -1)
      const newTask: Task = {
        ...taskData,
        id: `task-${Date.now()}`,
        order: maxOrder + 1,
        createdAt: new Date().toISOString(),
      }
      setTasks([...tasks, newTask])
    },
    [tasks, setTasks]
  )

  const handleSendMessage = useCallback(
    async (memberId: string, body: string) => {
      const myMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        memberId,
        from: 'me',
        body,
        timestamp: Date.now(),
      }

      const nextThread = [...(messages[memberId] ?? []), myMsg]
      setMessages((prev) => ({ ...prev, [memberId]: nextThread }))

      try {
        const res = await fetch('/api/npc-reply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            memberId,
            messages: nextThread.map((message) => ({ from: message.from, body: message.body })),
          }),
        })
        const json = await res.json()
        if (json?.reply) {
          const themMsg: ChatMessage = {
            id: `msg-${Date.now()}-npc`,
            memberId,
            from: 'them',
            body: json.reply,
            timestamp: Date.now(),
          }
          setMessages((prev) => ({ ...prev, [memberId]: [...(prev[memberId] ?? []), themMsg] }))
        }
      } catch (error) {
        console.error(error)
      }
    },
    [messages, setMessages]
  )

  const handleCreateTicketForMember = useCallback((member: Member) => {
    setWizardPrefillAssignee(member.name)
    setWizardOpen(true)
  }, [setWizardOpen])

  const handleMessageMember = useCallback((member: Member) => {
    setActiveConversationId(member.id)
    setActiveTab('messenger')
  }, [setActiveTab])

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Project Manager</h1>
              <p className="text-sm text-muted-foreground">
                Manage tasks, team members, and documentation
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-5">
            <TabsTrigger value="board" className="gap-1.5" data-testid="nav-board-tab">
              <KanbanSquare className="h-4 w-4" />
              Board
            </TabsTrigger>
            <TabsTrigger value="members" className="gap-1.5" data-testid="nav-members-tab">
              <Users className="h-4 w-4" />
              Members
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-1.5" data-testid="nav-docs-tab">
              <FileText className="h-4 w-4" />
              Docs
            </TabsTrigger>
            <TabsTrigger value="workflow" className="gap-1.5" data-testid="nav-workflow-tab">
              <Workflow className="h-4 w-4" />
              Workflow
            </TabsTrigger>
            <TabsTrigger value="messenger" className="gap-1.5" data-testid="nav-messenger-tab">
              <MessageSquare className="h-4 w-4" />
              Messenger
            </TabsTrigger>
          </TabsList>

          <TabsContent value="board">
            <KanbanBoard
              tasks={tasks}
              members={members}
              onTasksChange={setTasks}
              onNewTask={() => {
                setWizardPrefillAssignee('')
                setWizardOpen(true)
              }}
            />
          </TabsContent>

          <TabsContent value="members">
            <MemberTable
              members={members}
              onCreateTicket={handleCreateTicketForMember}
              onMessageMember={handleMessageMember}
            />
          </TabsContent>

          <TabsContent value="docs">
            <DocumentViewer />
          </TabsContent>

          <TabsContent value="workflow">
            <WorkflowEditor
              initialNodes={SEED_WORKFLOW_NODES}
              initialEdges={SEED_WORKFLOW_EDGES}
            />
          </TabsContent>

          <TabsContent value="messenger">
            <Messenger
              members={members}
              messages={messages}
              activeConversationId={activeConversationId}
              onSelectConversation={setActiveConversationId}
              onSendMessage={handleSendMessage}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Task Wizard Dialog */}
      <TaskWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        members={members}
        prefillAssignee={wizardPrefillAssignee}
        onSubmit={handleNewTask}
      />
    </div>
  )
}

export default App
