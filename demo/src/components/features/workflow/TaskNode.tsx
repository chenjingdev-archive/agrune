import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { WorkflowNodeData } from '@/types'

export function TaskNode({ id, data }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div
      className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/50 px-4 py-3 shadow-sm min-w-[110px]"
      data-agrune-demo="workflow-node"
      data-workflow-node-id={id}
      data-workflow-node-type="task"
    >
      <div className="text-xs font-medium text-muted-foreground">{data.label}</div>
      <div className="text-[11px] text-muted-foreground/70 mt-0.5">{data.description}</div>
      <Handle
        type="target"
        position={Position.Left}
        className="!z-10 !h-3.5 !w-3.5 !border-2 !border-background !bg-muted-foreground !shadow-sm"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!z-10 !h-3.5 !w-3.5 !border-2 !border-background !bg-muted-foreground !shadow-sm"
      />
    </div>
  )
}
