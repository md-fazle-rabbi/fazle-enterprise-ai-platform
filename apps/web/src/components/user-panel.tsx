import { cardClass, secondaryButtonClass } from "@/components/styles";

type UserPanelProps = {
  username: string;
  email?: string;
  tenants: string[];
  roles: string[];
};

export function UserPanel({ username, email, tenants, roles }: UserPanelProps) {
  return (
    <section aria-labelledby="user-heading" className={`${cardClass} flex flex-col gap-3 p-5`}>
      <div className="flex items-center gap-3">
        {/* Why: decorative only. The heading already says who is signed in. */}
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-base font-semibold text-white"
        >
          {username.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 id="user-heading" className="text-lg font-medium">
            Signed in as {username}
          </h2>
          {email ? (
            <p className="truncate text-sm text-neutral-600 dark:text-neutral-300">{email}</p>
          ) : null}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">Tenants</dt>
        <dd>{tenants.length > 0 ? tenants.join(", ") : "No tenant assigned"}</dd>
        <dt className="font-medium">Roles</dt>
        <dd>{roles.length > 0 ? roles.join(", ") : "None"}</dd>
      </dl>
      <form method="post" action="/api/auth/logout">
        <button type="submit" className={secondaryButtonClass}>
          Sign out
        </button>
      </form>
    </section>
  );
}
