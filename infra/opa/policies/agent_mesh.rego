package agent_mesh

default allow := false

allowed_tools := {
	"research-agent": {"query_kb"},
	"orchestrator-agent": {"query_kb", "dispatch_agent"},
}

allow if {
	input.tool in allowed_tools[input.agent_id]
}