# Drop Jest: Node has a test runner now

Node.js ships its own test runner. `node:test` was added in Node 18, and it has been stable
since Node 18, so there is no reason left to install a test framework.

We moved our API service over last month. Our suite of 400 tests ran in 9 seconds with Jest
and in 3 seconds with node:test, with no other change.

Fewer dependencies mean fewer supply-chain risks and faster installs. Every Node project
should therefore drop Jest and use node:test.
