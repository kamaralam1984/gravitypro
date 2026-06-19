# Infrastructure Design Document: Trackalways Gravity

**Project:** Trackalways Gravity (Family Safety & Connection Platform)
**Author:** Rodney Otieno
**Date:** May 2026

---

## 1. Executive Summary & Architecture Principles

This document establishes the infrastructure design for **Trackalways Gravity**, tailored specifically for a lean, 1-2 developer team. Rather than adopting an entirely new Backend-as-a-Service (BaaS) platform, this architecture optimizes and builds upon Trackalways' existing production-tested ecosystem.

The design relies on three core principles:

- **Code & Competency Reuse:** Utilizing the core Node.js/Express and Expo/React Native patterns already running in production to ensure a rapid, high-confidence 2-month delivery.
- **Geospatial Integrity:** Anchoring all location tracking, geofencing, and circle data models to a strict relational database with deep geospatial indexing capabilities.
- **Developer Efficiency:** Offloading operations, security certificates, and asset hosting to automated, low-to-zero maintenance cloud edges.

## 2. Global Core Architecture Topology

Gravity is a global application targeting users across **Kenya, India, UAE, UK, and the USA**. To balance cross-continental latency with operational simplicity, a centralized backend strategy with an optimized edge routing layer will be used.

## 3. Technology Stack Breakdown

| Infrastructure Layer | Selected Component | Pragmatic Justification & Execution Strategy |
|---|---|---|
| Edge Routing & Proxy | Caddy Server | Replaces complex Nginx setups. Natively handles automated Let's Encrypt/ZeroSSL TLS certificates, manages reverse-proxy rules, and handles Server-Sent Events (SSE) buffering streams natively. |
| Mobile Client Engine | Expo 54 + React Native 0.81 | Full cross-platform consistency for iOS and Android. Reuses proven maps, background tracking lifecycles, and notification frameworks from existing company products. |
| Telemetry Ingestion | Traccar Middleware | Hosted on a lightweight cloud instance. Absorbs high-concurrency raw UDP/TCP or HTTP tracking pings from background mobile devices, shielding the primary application layer from ingestion spikes. |
| Application Backend | Node.js (v20+) + Express 5.2.x | Eliminates the learning curve of a new framework. Handles authentication, circle permissions, business logic, and outbound transactional logic via proven boilerplates. |
| Core Database | PostgreSQL (Neon Cloud) + PostGIS | Non-negotiable for location processing. PostGIS allows optimized geospatial intersection queries (e.g., determining if a user coordinate is within a custom polygon safe zone) using structured data relations. Hosted in Frankfurt/Europe-Central for optimal global routing equilibrium. |
| Object Storage | Cloudflare R2 | Dedicated storage bucket for user profile pictures (avatar_url) and family group graphics (icon). Zero egress fees, standard S3-compatible API, and requires zero maintenance or server provisioning. |
| Real-time Pipeline | Server-Sent Events (SSE) | Unidirectional event streams for location maps. Lower protocol overhead than WebSockets for standard read-heavy data pipelines. Runs in-app memory for Day 1 MVP; drops in Redis Pub/Sub when scaling horizontally. |
| Background Orchestration | node-cron → BullMQ | Start with node-cron for immediate Phase 1 MVP features. Transition to a Redis-backed BullMQ engine as traffic increases to ensure reminders (e.g., medication alarms) survive server restarts. |

## 4. Primary Data Flows

### A. Location Ingestion & Safe Zone Geofencing

1. The **React Native Client** wakes up in the background using native Significant Location Change (SLC) APIs to protect device battery life.
2. The coordinate payload is securely transmitted over HTTPS to the **Caddy Edge Proxy**.
3. Caddy instantly routes the stream directly to **Traccar**, which logs the raw telemetry.
4. Traccar pings the **Express Backend** asynchronously via webhook.
5. The backend executes a fast PostGIS relational validation query: `ST_Contains(safe_zone.geom, user_location.geom)`
6. If a status change is detected (e.g., entering or exiting a defined zone), a transactional payload is dropped into the push notification gateway.

### B. Media & Profile Asset Upload

1. The user updates an avatar or custom circle icon inside the app.
2. The mobile client requests a pre-signed, short-lived upload URL from the Express API.
3. The client uploads the asset directly to **Cloudflare R2**, completely bypassing the application server's bandwidth limits.
4. The client saves the resulting immutable URL to the relational users table in PostgreSQL.
