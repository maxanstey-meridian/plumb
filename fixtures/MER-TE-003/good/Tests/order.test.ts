const documentation = `Received.InOrder(() => dependency.run())`;
test("documents the API", () => expect(documentation).toContain("InOrder"));
