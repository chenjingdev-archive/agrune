import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { WorkflowNodeData } from '@/types'

export function StageNode({ id, data }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div
      className="rounded-lg border-2 border-primary/30 bg-card px-6 py-4 shadow-md min-w-[140px]"
      data-agrune-demo="workflow-node"
      data-workflow-node-id={id}
      data-workflow-node-type="stage"
    >
      <div className="text-sm font-semibold text-foreground">{data.label}</div>
      <div className="text-xs text-muted-foreground mt-1">{data.description}</div>
      <Handle
        type="target"
        position={Position.Left}
        className="!z-10 !h-4 !w-4 !border-2 !border-background !bg-primary !shadow-sm"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!z-10 !h-4 !w-4 !border-2 !border-background !bg-primary !shadow-sm"
      />
    </div>
  )
}
