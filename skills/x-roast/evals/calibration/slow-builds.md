# Why CI got slow

## Question
CI went from about 6 minutes to about 14 minutes in March. Why?

## Finding
On 3 March we upgraded the CI image from Node 20 to Node 22. The build before the upgrade took
6 min 10 s and the build after it took 13 min 50 s. Node 22 is therefore the cause.

## Recommendation
Pin CI back to Node 20 until Node 22 is faster.
