"use client";

import type { WizardState } from "./project-wizard";

interface StepRepositoryProps {
  state: WizardState;
  groups: string[];
  onChange: (patch: Partial<WizardState>) => void;
}

export function StepRepository({ state, groups, onChange }: StepRepositoryProps) {
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="team" className="block text-sm font-medium mb-1.5">
          Team
        </label>
        <select
          id="team"
          value={state.team}
          onChange={(e) => onChange({ team: e.target.value })}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        >
          <option value="">Select a team...</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          The repository will be created under this team&apos;s Gitea organisation.
        </p>
      </div>

      <div>
        <label htmlFor="appName" className="block text-sm font-medium mb-1.5">
          App Name
        </label>
        <input
          id="appName"
          type="text"
          value={state.appName}
          onChange={(e) =>
            onChange({
              appName: e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")
                .replace(/-+/g, "-"),
            })
          }
          placeholder="my-service"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Lowercase, hyphens only. Used as repo name, namespace suffix, and catalog
          entity name.
        </p>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium mb-1.5">
          Description
          <span className="ml-1 text-muted-foreground font-normal">(optional)</span>
        </label>
        <textarea
          id="description"
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          placeholder="Brief description of the service..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wxops-purple/50 resize-none"
        />
      </div>
    </div>
  );
}
