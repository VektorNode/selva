using System;
using Grasshopper.Kernel;
using Microsoft.Extensions.Logging;

/// <summary>
/// Simple logger implementation that outputs to Grasshopper component
/// </summary>
public class GrasshopperLogger<T> : ILogger<T>
{
    private readonly GH_Component _component;

    public GrasshopperLogger(GH_Component component)
    {
        _component = component;
    }

    public IDisposable BeginScope<TState>(TState state) => null;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception exception, Func<TState, Exception, string> formatter)
    {
        var message = formatter(state, exception);

        switch (logLevel)
        {
            case LogLevel.Error:
            case LogLevel.Critical:
                _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Error, message);
                break;
            case LogLevel.Warning:
                _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, message);
                break;
            case LogLevel.Information:
            case LogLevel.Debug:
            case LogLevel.Trace:
                _component.AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, message);
                break;
        }
    }
}