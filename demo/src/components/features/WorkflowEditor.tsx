import { useCallback, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type BuiltInEdge,
  type Connection,
  type FinalConnectionState,
  type OnConnect,
  type OnConnectEnd,
  type EdgeMouseHandler,
} from '@xyflow/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StageNode } from '@/components/features/workflow/StageNode'
import { TaskNode } from '@/components/features/workflow/TaskNode'
import type { WorkflowNodeData } from '@/types'

interface WorkflowEditorProps {
  initialNodes: Node<WorkflowNodeData>[]
  initialEdges: Edge[]
}

const nodeTypes = {
  stage: StageNode,
  task: TaskNode,
}

const EDGE_STYLE = {
  stroke: 'var(--muted-foreground)',
  strokeWidth: 1.5,
}

function getParallelEdgeOffset(index: number) {
  const distance = 24 + Math.floor(index / 2) * 16
  return index % 2 === 0 ? distance : -distance
}

function normalizeEdge(edge: Edge): Edge {
  return {
    ...edge,
    type: edge.type ?? 'smoothstep',
    style: {
      ...EDGE_STYLE,
      ...edge.style,
    },
  }
}

function createWorkflowEdge(
  connection: Connection,
  edges: Edge[],
  defaultEdgeOptions: Partial<Edge>
): BuiltInEdge {
  const samePairEdges = edges.filter(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
      (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
  )
  const edgeIndex = samePairEdges.length

  return {
    ...defaultEdgeOptions,
    id: `workflow-edge-${Date.now()}-${edgeIndex}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: 'smoothstep',
    pathOptions: {
      offset: getParallelEdgeOffset(edgeIndex),
    },
    style: EDGE_STYLE,
  }
}

function hasMatchingEdge(connection: Connection, edges: Edge[]) {
  return edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
      (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
  )
}

function getConnectionSignature(connection: Connection) {
  return [
    connection.source,
    connection.sourceHandle ?? '',
    connection.target,
    connection.targetHandle ?? '',
  ].join('::')
}

function getConnectionFromState(state: FinalConnectionState): Connection | null {
  if (!state.isValid || !state.fromHandle || !state.toHandle) {
    return null
  }

  if (state.fromHandle.type === 'source') {
    return {
      source: state.fromHandle.nodeId,
      sourceHandle: state.fromHandle.id ?? null,
      target: state.toHandle.nodeId,
      targetHandle: state.toHandle.id ?? null,
    }
  }

  return {
    source: state.toHandle.nodeId,
    sourceHandle: state.toHandle.id ?? null,
    target: state.fromHandle.nodeId,
    targetHandle: state.fromHandle.id ?? null,
  }
}

export function WorkflowEditor({ initialNodes, initialEdges }: WorkflowEditorProps) {
  const normalizedInitialEdges = useMemo(
    () => initialEdges.map(normalizeEdge),
    [initialEdges]
  )
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(normalizedInitialEdges)
  const lastCommittedSignatureRef = useRef<string | null>(null)

  const defaultEdgeOptions = useMemo(
    () => ({
      animated: true,
      type: 'smoothstep',
      interactionWidth: 24,
      style: EDGE_STYLE,
    }),
    []
  )

  const commitConnection = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return
      }

      const signature = getConnectionSignature(connection)
      lastCommittedSignatureRef.current = signature
      queueMicrotask(() => {
        if (lastCommittedSignatureRef.current === signature) {
          lastCommittedSignatureRef.current = null
        }
      })

      setEdges((eds) => {
        if (hasMatchingEdge(connection, eds)) {
          return eds
        }

        return [...eds, createWorkflowEdge(connection, eds, defaultEdgeOptions)]
      })
    },
    [defaultEdgeOptions, setEdges]
  )

  const onConnect: OnConnect = useCallback(
    (connection) => {
      commitConnection(connection)
    },
    [commitConnection]
  )

  const onConnectEnd: OnConnectEnd = useCallback(
    (_event, connectionState) => {
      const connection = getConnectionFromState(connectionState)
      if (!connection) {
        return
      }

      const signature = getConnectionSignature(connection)
      if (lastCommittedSignatureRef.current === signature) {
        return
      }

      commitConnection(connection)
    },
    [commitConnection]
  )

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      setEdges((eds) => eds.filter((currentEdge) => currentEdge.id !== edge.id))
    },
    [setEdges]
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Workflow Editor</CardTitle>
        <CardDescription>
          같은 카드 쌍은 한 번만 연결됩니다. 선을 클릭하면 연결이 삭제됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[600px] w-full" data-agrune-demo="workflow-canvas">
          <ReactFlow
            className="agrune-workflow-flow"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onEdgeClick={onEdgeClick}
            connectionRadius={32}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            // Deterministic agrune-driven node drags: threshold 0 pins the grab
            // origin to the pointerdown point (so a drag lands exactly at the
            // destination), and disabling auto-pan keeps the coordinate frame
            // fixed mid-drag. fitView stays on so every seeded node is in-pane.
            nodeDragThreshold={0}
            autoPanOnNodeDrag={false}
          >
            <Background />
            <Controls />
            <MiniMap
              nodeStrokeWidth={3}
              zoomable
              pannable
            />
          </ReactFlow>
        </div>
      </CardContent>
    </Card>
  )
}
