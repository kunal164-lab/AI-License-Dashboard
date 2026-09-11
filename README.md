# AI IT Dashboard

An internal enterprise dashboard for monitoring, analyzing, and optimizing IT licenses, software usage, user activity, and technology costs across multiple business units and technology providers.

The application provides a centralized view of Microsoft 365/Copilot, Kiro, Claude, Freshservice, GitHub Copilot, and other future technology products.

---

## Overview

The AI IT Dashboard is designed to provide IT, administrators, and business stakeholders with a single source of truth for:

- User and license management
- Product and subscription tracking
- License utilization
- Usage analytics
- Cost analysis
- License optimization
- Potential savings identification
- Provider-level reporting
- Department and VBU analysis
- Dashboard-specific branding and data views
- Role-based access control
- Microsoft Entra ID authentication
- Administrative audit logging

The application supports multiple business units (VBUs) while maintaining a single shared application and centralized data model.

---

## Key Capabilities

### Dashboard

The dashboard provides:

- Total tracked users
- License and product overview
- Usage statistics
- Cost summaries
- Cost trends
- Product activity
- License utilization
- Optimization opportunities
- Potential savings
- Provider/product analysis

Dashboard content is automatically scoped according to the authenticated user's authorization and VBU.

---

## Dashboard Views

The application supports multiple Dashboard Views using the same underlying application and codebase.

Current views include:

### SSP Central Services

The primary central/internal IT dashboard.

### SSP Worldwide

A global dashboard experience with worldwide branding and data scope.

### SSP UK & Ireland

A dedicated UK & Ireland dashboard experience with its own branding, theme, navigation visibility, and VBU scope.

Dashboard Views can be configured by administrators.

A Dashboard View can control:

- Display name
- Branding
- Logo
- Theme
- Sidebar visibility
- Dashboard configuration
- Allowed VBUs
- Page visibility

Dashboard View configuration is **not a security boundary**. RBAC and backend VBU authorization remain authoritative.

---

## Security Model

Security is enforced on the backend.

The application uses:

- Microsoft Entra ID / Microsoft 365 authentication
- Application role/security-group based authorization
- Role-based access control (RBAC)
- VBU-based data isolation
- Persistent server-side sessions
- Administrative access controls
- Authentication and authorization audit logging

The frontend must never be treated as the security boundary.

All business-data APIs enforce the effective authorization and VBU scope on the server.

---

## VBU Data Scoping

VBU is sourced from the authoritative Microsoft Graph directory field:

```text
onPremisesExtensionAttributes.extensionAttribute3
