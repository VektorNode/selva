# Plugin Code Audit: Selva

## Overview

This audit focuses on the C# codebase within the `Plugin/` directory, specifically `Selva.Core` and `Selva.Grasshopper`. The goal is to identify areas for improvement in efficiency, maintainability, performance, and best practices, with a focus on simplicity and reducing complexity.

## 1. Architecture & Structure

### Strengths

- **Separation of Concerns**: The division between `Selva.Core` (logic/models) and `Selva.Grasshopper` (UI/Rhino integration) is excellent. It allows for potential reuse of core logic in other contexts (e.g., a standalone CLI or web API).
- **Configuration Management**: `AppConfig.cs` provides a centralized location for constants and settings, which is good for maintainability.

### Areas for Improvement

- **"God Class" Components**: `GH_UIBuilderComponent.cs` is nearly 1000 lines long. It handles Grasshopper component lifecycle, WebSocket communication orchestration, state management, and serialization.
  - **Risk**: High complexity makes it hard to debug and extend.
  - **Fix**: Refactor by extracting responsibilities into dedicated services (e.g., `ComponentStateManager`, `BridgeCommunicationService`).
- **Static Coupling**: Heavy reliance on static classes (`Logger`, `AppConfig`) makes unit testing difficult because dependencies cannot be mocked easily.

## 2. Code Maintainability

### Strengths

- **Readable Code**: Variable naming and general code style are clear and follow C# conventions.
- **Explicit Validation**: `SchemaValidator` uses a clear pattern of collecting issues rather than throwing exceptions immediately.

### Areas for Improvement

- **Hardcoded Validation Logic**: `SchemaValidator` contains monolithic methods (`ValidateBasicStructure`, `ValidateParameters`). Adding a new rule requires modifying the core class.
  - **Fix**: Implement the **Strategy Pattern** or use a library like **FluentValidation**. Create small, reusable rule classes (e.g., `InputParameterRule`, `LayoutRule`) that can be composed together.
- **Magic Numbers/Strings**: While `AppConfig` helps, there are still hardcoded strings in `Logger` (`"[Selva] "`) and potentially elsewhere.

## 3. Performance & Efficiency

### Strengths

- **Buffer Sizing**: `AppConfig` defines explicit buffer sizes (`BufferSizeBytes`), showing awareness of I/O performance.

### Areas for Improvement

- **Synchronous Logging**: The `Logger` class uses `RhinoApp.WriteLine` directly. In high-frequency loops or heavy processing, this can block the Rhino UI thread.
  - **Fix**: Use a producer-consumer pattern for logging. Queue log messages and write them to Rhino/Disk on a background thread, or use a robust logging library (e.g., Serilog) if compatible.
- **Large Object Allocations**: `SchemaValidator` creates new lists and objects frequently. For large schemas, this could cause GC pressure.
  - **Fix**: Use `IEnumerable<T>` for lazy evaluation where possible instead of creating intermediate `List<T>`.

## 4. Best Practices

### Strengths

- **Standard Compliance**: `Selva.Core` targets `netstandard2.0`, ensuring broad compatibility.
- **Error Handling**: The use of `ValidationResult` objects instead of exceptions for business logic errors is a best practice.

### Areas for Improvement

- **Dependency Injection (DI)**: The project currently relies on manual instantiation and static access.
  - **Fix**: Introduce a lightweight DI container (or a simple Service Locator pattern) to manage dependencies like `ICommunicationHandler`, `IValidator`, etc. This improves testability and decoupling.
- **Concurrency Safety**: `GH_UIBuilderComponent` uses flags like `_isStartingWebSocket` to manage state. This is prone to race conditions.
  - **Fix**: Use `SemaphoreSlim` or other proper synchronization primitives for async resource management.

## Action Plan

1.  **Refactor `GH_UIBuilderComponent`**: Break it down. Move the WebSocket orchestration logic into a `BridgeService` that the component simply calls.
2.  **Modernize Validation**: Refactor `SchemaValidator` to use a rules-based approach.
3.  **Async Logging**: Update `Logger` to be non-blocking.
4.  **Introduce Abstractions**: Create interfaces for key services (`ICommunicationService`, `IStateService`) to decouple the Grasshopper component from the implementation details.

## Summary

The codebase is in a healthy state with a solid foundation. The main technical debt lies in the size of the main Grasshopper component and the rigidity of the validation logic. Addressing these will significantly improve maintainability and reduce the risk of bugs in future updates.
