"use client";

import { Text } from "@opal/components";
import { SvgBubbleText } from "@opal/icons";
import MinimalMarkdown from "@/components/chat/MinimalMarkdown";
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
        <SvgBubbleText className="w-4 h-4 stroke-text-03 shrink-0" />
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

      {subagent.prompt && (
        <div className="flex flex-col gap-1 pb-3">
          <Text font="main-ui-muted" color="text-02">
            Prompt
          </Text>
          <div className="max-h-[14rem] overflow-y-auto whitespace-pre-wrap break-words">
            <Text as="p" font="secondary-body" color="text-04">
              {subagent.prompt}
            </Text>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {subagent.toolCalls.map((tc) => (
          <CraftToolCard key={tc.id} toolCall={tc} />
        ))}
      </div>

      {subagent.response !== null && (
        <div className="flex flex-col gap-1 pt-3">
          <Text font="main-ui-muted" color="text-02">
            Response
          </Text>
          <div className="max-h-[24rem] overflow-y-auto break-words">
            <MinimalMarkdown
              content={subagent.response}
              className="text-text-05"
            />
          </div>
        </div>
      )}
    </div>
  );
}
