namespace Microsoft.Azure.Functions.Worker.Http;

public abstract class HttpResponseData
{
    public abstract Task WriteAsJsonAsync<T>(T instance);
}

public abstract class HttpRequestData
{
    public abstract HttpResponseData CreateResponse(HttpStatusCode statusCode);
}
