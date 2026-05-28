"use client";

import { Text, Tag } from "@opal/components";
import { SvgBubbleText } from "@opal/icons";
import { useSubagent } from "@/app/craft/hooks/useBuildSessionStore";
import CraftToolCard from "@/app/craft/components/tool-cards/CraftToolCard";

interface SubagentTabProps {
  subagentSessionId: string;
}

/**
 * SubagentTab - Body of a subagent transcript panel tab. Shows the subagent's
 * type badge, name, run status, and the list of tool calls it emitted.
 */
export default function SubagentTab({ subagentSessionId }: SubagentTabProps) {
  const subagent = useSubagent(subagentSessionId);

  if (!subagent) {
    return (
      <div className="flex h-full items-center justify-center">
        <Text font="main-ui-body" color="text-02">
          Subagent not found.
        </Text>
      </div>
    );
  }

  const stepCount = subagent.toolCalls.length;
  const isRunning = subagent.status === "running";
  const statusLabel = `${subagent.status} · ${stepCount} ${
    stepCount === 1 ? "step" : "steps"
  }`;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="flex items-center gap-2 pb-3">
        {subagent.subagentType && (
          <Tag
            icon={SvgBubbleText}
            title={subagent.subagentType}
            color="purple"
            size="sm"
          />
        )}
        {subagent.name && (
          <Text font="main-ui-action" color="text-04" nowrap>
            {subagent.name}
          </Text>
        )}
        <span className="ml-auto">
          <Text
            font={isRunning ? "main-ui-action" : "main-ui-muted"}
            color={isRunning ? "text-04" : "text-02"}
            nowrap
          >
            {statusLabel}
          </Text>
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {subagent.toolCalls.map((tc) => (
          <CraftToolCard key={tc.id} toolCall={tc} />
        ))}
      </div>
    </div>
  );
}
