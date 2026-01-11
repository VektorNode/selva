# Deployment Guide

This section covers deploying Selva applications to production environments. The Selva platform consists of two main applications with different deployment models:

---

## Quick Navigation

### **Compute App Deployment**

Deploy the web application that solves Grasshopper definitions via Rhino.Compute in the cloud.

- **[Compute App Deployment Overview](./compute-app/OVERVIEW.md)** — Start here
- **[Deployment Prerequisites](./compute-app/PREREQUISITES.md)** — System requirements and network setup
- **[Server Setup](./compute-app/SERVER_SETUP.md)** — Install Node.js, clone repo, build
- **[Definitions Configuration](./compute-app/DEFINITIONS_SETUP.md)** — Configure your Grasshopper definitions
- **[Node.js Deployment](./compute-app/NODE_DEPLOYMENT.md)** — Deploy directly without Docker
- **[Docker Deployment](./compute-app/DOCKER_DEPLOYMENT.md)** — Deploy with Docker containers

---

## Application Overview

### **Compute App** (Recommended for Production)

A standalone web application that solves Grasshopper definitions through a Rhino.Compute server. Perfect for cloud deployments.

**Best for:**

- Production web applications
- Cloud deployments (AWS, Azure, GCP)
- Multi-user environments
- Isolated computation

**Key requirements:**

- Rhino.Compute server (cloud or self-hosted)
- Grasshopper definition files (.gh)
- Node.js or Docker runtime

**Deployment options:**

1. [Node.js with PM2](./compute-app/NODE_DEPLOYMENT.md) — Simple, direct
2. [Docker containers](./compute-app/DOCKER_DEPLOYMENT.md) — Reproducible, scalable
