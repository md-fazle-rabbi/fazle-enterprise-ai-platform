local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local current = tonumber(redis.call('GET', key) or '0')
local new_total = current + cost

if new_total > limit then
    return {current, limit, 1}
end

redis.call('INCRBY', key, cost)
if current == 0 then
    redis.call('EXPIRE', key, window_seconds)
end

return {new_total, limit, 0}