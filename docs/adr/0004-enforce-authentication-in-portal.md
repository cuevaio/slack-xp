# Enforce publish authentication in Portal

Office Channels require `anonymous: false`, and only eligible authenticated New Hires receive Portal user tokens in the browser. Observers read a narrowly projected current-day history feed through the Portal Messenger server, which retains the Portal credential and applies safety projections before returning public message fields. This preserves authenticated-only publishing without relying on React controls or hosted Portal hooks. Private Office Event and HR Report channels also require `anonymous: false`.
