import type { GameData } from "../../../../src/data/types.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";

const PILL: Record<Issue["severity"], string> = { invalid: "bad", incomplete: "todo", notice: "muted" };

/** Engine issues shown where they arise; a missing choice is left out, its dashed "to decide" button already says it. */
export default function IssueList({ data, issues }: { data: GameData; issues: Issue[] }) {
  const { lang, issueMessage } = useI18n();
  const shown = issues.filter((issue) => issue.code !== "choiceMissing");
  if (shown.length === 0) return null;
  return (
    <ul className="issues">
      {shown.map((issue, i) => (
        <li key={i} className={`pill ${PILL[issue.severity]}`}>
          {issueMessage(issue, (kind, id) => gameName(data, lang, kind, id))}
        </li>
      ))}
    </ul>
  );
}
