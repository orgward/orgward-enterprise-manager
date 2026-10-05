# Loopback sandbox test service

OrgWard can route owner-approved procurement test effects to a separate local
HTTP service instead of its in-process deterministic test harness. The service
has its own durable JSON operation ledger and returns a versioned receipt bound
to the stable provider key and request hash. It listens only on `127.0.0.1`;
the adapter rejects any configured non-loopback URL. It cannot call a supplier,
payment rail, legal service, device, or other third-party provider.

Start the companion service with a private state file:

```sh
ORGWARD_LOCAL_SANDBOX_STATE=/var/lib/orgward/local-sandbox-test.json \
ORGWARD_LOCAL_SANDBOX_TOKEN='<same private value of at least 32 characters in both processes>' \
ORGWARD_LOCAL_SANDBOX_PORT=7310 \
node ops/local-sandbox-provider.mjs
```

Start OrgWard with the loopback adapter selected:

```sh
ORGWARD_LOCAL_SANDBOX_TOKEN='<same private value of at least 32 characters in both processes>' \
ORGWARD_LOCAL_SANDBOX_PROVIDER_URL=http://127.0.0.1:7310 npm start
```

Without `ORGWARD_LOCAL_SANDBOX_PROVIDER_URL`, OrgWard keeps using the
in-process `LOCAL_TEST_ONLY` harness. With it set, owner-approved dispatches
cross the versioned HTTP boundary and the companion service persists one local
test receipt per stable provider key. Reconciliation reads that service's
ledger and never dispatches another effect. UI and stored evidence distinguish
the service call from a third-party provider call. This is a separately
running first-party test service; it does not demonstrate a qualified vendor
connector, a live supplier fulfilment, or a real commercial transaction.
