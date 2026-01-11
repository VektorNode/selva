# Security Guide for Selva Compute App

This document consolidates all security considerations and best practices for deploying and maintaining the Selva Compute App.

---

## Protecting Your Intellectual Property

Your Grasshopper definitions contain valuable intellectual property that must be protected from unauthorized access or disclosure.

### Grasshopper Definition Files (.gh)

**Critical Rules:**

- **Never commit `.gh` files to public repositories** - This is the most important rule. Your definitions will be permanently exposed
- Use `GH_DEFINITIONS_PATH` (local files) instead of public URLs when possible
- Keep definition files in secure, access-controlled locations
- Set proper file permissions on definition files
- Keep backups of your definition files in a secure location
- Use version control for definitions only in **private repositories**
