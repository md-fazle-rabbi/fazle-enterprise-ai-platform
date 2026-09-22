import { primaryButtonClass } from "@/components/styles";

type UserPanelProps = {
  username: string;
  email?: string;
  tenants: string[];
  roles: string[];
};

export function UserPanel({ username, email, tenants, roles }: UserPanelProps) {
  return (
    <section
      aria-labelledby="user-heading"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
    >
      <h2 id="user-heading" className="text-lg font-medium">
        Signed in as {username}
      </h2>
      {email ? <p className="text-sm text-neutral-600 dark:text-neutral-300">{email}</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Tenants</dt>
        <dd>{tenants.length > 0 ? tenants.join(", ") : "No tenant assigned"}</dd>
        <dt className="font-medium">Roles</dt>
        <dd>{roles.length > 0 ? roles.join(", ") : "None"}</dd>
      </dl>
      <form method="post" action="/api/auth/logout">
        <button type="submit" className={primaryButtonClass}>
          Sign out
        </button>
      </form>
    </section>
  );
}
