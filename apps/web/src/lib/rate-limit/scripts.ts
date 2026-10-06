// Why: Lua, so each check-and-record runs as ONE atomic step inside Redis. Done as separate
// commands from Node, two requests arriving together could both see "19 of 20 used" and both
// be let through. Time comes from Redis (TIME), not from this process, so several app
// instances can never disagree about what "now" is.

// KEYS[1] = key. ARGV = window ms, limit, a unique id for this request.
// Returns {allowed (1 or 0), requests in the window including this one, ms until a slot frees}.
export const SLIDING_WINDOW_SCRIPT = `
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window)
local count = redis.call("ZCARD", KEYS[1])
if count >= limit then
  local oldest = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")
  return {0, count, window - (now - tonumber(oldest[2]))}
end
redis.call("ZADD", KEYS[1], now, ARGV[3])
redis.call("PEXPIRE", KEYS[1], window)
return {1, count + 1, 0}
`;

// A stream "slot" is a sorted-set entry whose score is the moment it expires. Entries past
// their time are dropped on every acquire, so a crashed process cannot leak a slot forever.
// KEYS[1] = key. ARGV = max slots, holder ttl ms, a unique id for this holder. Returns 1 or 0.
export const ACQUIRE_SLOT_SCRIPT = `
local t = redis.call("TIME")
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
local ttl = tonumber(ARGV[2])
redis.call("ZADD", KEYS[1], now + ttl, ARGV[3])
redis.call("PEXPIRE", KEYS[1], ttl)
return 1
`;

// Removes only THIS holder's entry, so releasing twice can never free someone else's slot.
export const RELEASE_SLOT_SCRIPT = `return redis.call("ZREM", KEYS[1], ARGV[1])`;
