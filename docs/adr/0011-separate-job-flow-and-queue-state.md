# Separate Job, Flow, and Queue State

Qme will model Job State, Flow State, and Queue State separately. Jobs track execution lifecycle, Flows track operator-facing orchestration lifecycle, and Queues track execution availability; paused queues and Flows do not rewrite every waiting job into a paused job state.
