# Test harness lessons

- Use `node:http` to test forged Host headers. Node's built-in fetch can normalize/replace Host, making a correct server appear vulnerable.
- When restarting a listener on the same port inside a test, close test-client keep-alive connections. Otherwise a cached fetch connection can point to the destroyed server and cause an unrelated transient socket failure.
