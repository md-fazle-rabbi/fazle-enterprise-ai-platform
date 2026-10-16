type BackendStatusProps = {
  reachable: boolean;
};

export function BackendStatus({ reachable }: BackendStatusProps) {
  return (
    <p
      role="status"
      className="inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium dark:border-neutral-800 dark:bg-neutral-900"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${reachable ? "bg-emerald-600" : "bg-red-600"}`}
      />
      {reachable ? "Backend reachable" : "Backend unreachable"}
    </p>
  );
}
