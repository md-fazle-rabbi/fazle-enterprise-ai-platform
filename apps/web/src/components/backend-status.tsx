type BackendStatusProps = {
  reachable: boolean;
};

export function BackendStatus({ reachable }: BackendStatusProps) {
  return (
    <p role="status" className="inline-flex items-center gap-2 text-sm font-medium">
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${reachable ? "bg-emerald-600" : "bg-red-600"}`}
      />
      {reachable ? "Backend reachable" : "Backend unreachable"}
    </p>
  );
}
