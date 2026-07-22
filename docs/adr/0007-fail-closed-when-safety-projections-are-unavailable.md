# Fail closed when safety projections are unavailable

Portal Messenger does not render raw Portal history when Neon cannot provide the profile and message-removal projections needed to interpret it safely. Reduced availability is preferred over allowing Removed Message content or deleted profile data to reappear during a database outage.
