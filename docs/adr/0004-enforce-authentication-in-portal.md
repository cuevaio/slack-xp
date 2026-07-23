# Enforce publish authentication in Portal

Office Channels allow anonymous connections so Observers can read current messages. Portal `authz` grants `publish: false` to anonymous identities and `publish: true` to authenticated New Hires; hiding React controls is not considered an authorization boundary. Private Office Event and HR Report channels continue to require `anonymous: false`.
