---
title: Scaling
order: 3
published: true
description: 'Current limits of the compute and data path, and how to tune a deployment against them.'
---

# Scaling

## How a solve flows

The browser posts to `/api/v1/compute`, the Selva server calls Rhino.Compute, and the full JSON result comes back the same way.

- The browser never reaches Rhino.Compute. The Selva server holds its URL and API key.
- The `.gh`, inputs and result are buffered whole in Node memory and serialized with one blocking `JSON.stringify`. V8 caps a string near 512 MB, hence the 300 MB `COMPUTE_RESPONSE_MAX_BYTES`.
- File and geometry data travels as base64 in JSON (about 4/3 larger).
- A solve runs on one compute server: the definition's pin if it has one, else the resolved default. There is no load balancing, and each server's client has its own in-process FIFO queue. Pointer reuse and `cachesolve` are per server ([Caching](../concepts/caching.md)).
- `Server-Timing` and solve metrics show which limit you hit. Measure first.

### What breaks first

| #   | Bottleneck                                            | Symptom                                                     |
| --- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 1   | `JSON.stringify` of ~100 MB bodies on the main thread | One big solve stalls every request on the Node server       |
| 2   | Base64 file outputs                                   | ~1 GB tab memory per solve; server hits the V8 string limit |
| 3   | One compute server per solve                          | Queue buildup                                               |
| 4   | Synchronous request, 100 s deadline                   | Long solves impossible; connections held open               |

## Scale one server first

`rhino.compute` round-robins across `compute.geometry` children, each a full headless Rhino:

- `--childcount`: children (default 4, cap 64).
- `--idlespan`: seconds before an idle child exits and stops billing (default 3600).
- `--spawn-on-startup`: pre-warm children.

Max out cores and children on one VM before adding VMs. Raise `RHINO_COMPUTE_MAX_REQUEST_SIZE` (about 50 MB by default, like `MAX_DEFINITION_FILE_SIZE_BYTES`) for large payloads.

## Cost

[Core-hour billing](https://developer.rhino3d.com/guides/compute/core-hour-billing/) is $0.10 per core per hour on Rhino uptime, not usage: an idle 8-core VM is about $576 a month. One `RHINO_TOKEN` licenses the whole fleet; keep it secret, it bills your card. To cut cost, use `--idlespan` and stop VMs.

## Caching and networking

- With unique outputs a result cache rarely hits. Check the `selva_cache` Server-Timing metric and the `/admin/compute` caching panel before adding one.
- Keep compute servers, the Selva server and storage in one VPC and region. The Selva-to-compute hop carries the largest payloads.

## Running a second instance

The solve queue, warm-client LRU, caches, rate limiter, live solve-event bus and compute idempotency store all live in process. What that costs on a second instance:

- **Caches** split and only lose hit rate.
- **The rate limiter multiplies**: N instances enforce N times `COMPUTE_RATE_LIMIT_MAX`. Size it for that or move the limiter to a shared store.
- **Live solve events need sticky sessions.** A solve's events reach only the browser stream that is open on the same instance.
- **A retried solve that lands on the other instance re-solves** instead of replaying the first response.

The local provider is single-instance by design.
