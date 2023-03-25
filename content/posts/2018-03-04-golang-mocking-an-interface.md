---
title: "Golang: Mocking an interface"
date: 2018-03-04T00:00:00
draft: false
---

![](https://glucn.files.wordpress.com/2018/03/test-driven-development-of-go-web-applications-with-gin.png?w=1024&h=342&crop=1)

In Golang, interfaces allow us to replace certain functions with mocks to stub out methods we're not currently testing. I've seen several patterns to mock an interface, and today I want to discuss those patterns.

Let's say we have an interface like this:

```go
type Interface interface {
    Get(ctx context.Context, id string) (*model.Data, error)
    Update(ctx context.Context, data *model.Data) error
}
```

#### Pattern 1: Mocking with stub functions
We can define the mock struct as a collection of stub functions.
```go
type InterfaceMock struct {
    GetFunc func(ctx context.Context, id string) (*model.Data, error)
    UpdateFunc func(ctx context.Context, data *model.Data) error
}

func (m *InterfaceMock) Get(ctx context.Context, id string) (*model.Data, error) {
    if m.GetFunc != nil {
        return m.GetFunc(ctx, ID)
    }
    return nil
}

func (m *InterfaceMock) Update(ctx context.Context, data *model.Data) error {
    if m.UpdateFunc != nil {
        return m.UpdateFunc(ctx, ID)
    }
    return nil
}
```

In our tests, we can define the actual stub functions.

```go
type TestSuite struct {
    suite.Suite
    interfaceStub *InterfaceMock
}

func (s *TestSuite) Test_Something() {
    getFunc := func(ctx context.Context, id string) (*model.Data, error) {
        if id = "something" {
            return &model.Data{ID: id}, nil
        }
        return nil, errors.New("failed to get")
    }
    s.interfaceStub.GetFunc = getFunc

    // test the functions we want to test
    ...
}
```

We can define the logic of mocked functions as what we need in our test. It could be a simple return or an if check, while some fancier logic is also possible. If we are building a test suite, we can define the stub function in `SetupTest()` with a logic that can meet all the test cases.


#### Pattern 2: Mocking with tracking variables
We can define the mock struct as a collection of variables.
```go
type InterfaceMock struct {
    Method string
    Args map[string]interface{}
    ReturnValue interface{}
    ErrorToReturn error
}

func (m *InterfaceMock) Get(ctx context.Context, id string) (*model.Data, error){
    s.Method = "Get"
    s.Args = map[string]interface{}{
        "ID": id,
    }
    if s.ReturnValue != nil {
        return s.ReturnValue.(*model.Data), nil
    }
    return nil, s.ErrorToReturn
}

func (m *InterfaceMock) Update(ctx context.Context, data *model.Data) error {
    s.Method = "Update"
    s.Args = map[string]interface{}{
        "Data": data,
    }
    return s.ErrorToReturn
}
```

In our test, we can specify the return value of the mocked functions and assert the actual calls made on them.

```go
type TestSuite struct {
    suite.Suite
    interfaceStub *InterfaceMock
}

func (s *TestSuite) Test_Get_HappyPath() {
    s.interfaceStub.ReturnValue := &model.Data{ID: id}

    // test the functions we want to test
    ....

    s.NoError(err)
    s.Equal("Get", s.interfaceStub.Method)
    s.Equal("some ID", s.interfaceStub.Args["ID"])
}

func (s *TestSuite) Test_Get_SadPath() {
    s.interfaceStub.ErrorToReturn := errors.New("failed to get")

    // test the functions we want to test
    ....

    s.EqualError(err, "failed to get")
    s.Equal("Get", s.interfaceStub.Method)
    s.Equal("some ID", s.interfaceStub.Args["ID"])
}
```

In this pattern, we care more about the input and output of the mocked functions, rather than the inner logic of them. We can explicitly assert the input params to make sure the function we are testing makes the correct call to the mocked function.

#### Pattern 3: Mocking with testify.mock package
The `mock` package in [`testify`](https://github.com/stretchr/testify) provides a mechanism for easily writing mock objects that can be used in place of real objects when writing test code. In addition, we can use the [`mockery`](https://github.com/vektra/mockery) tool to autogenerate the mock code against an interface as well, making using mocks much quicker. With the following command, we can generate the mocks for all interfaces in the package.

```
mockery -all -dir . -case underscore -inpkg
```

In the generated file `mock_interface.go`, the codes should be like this:
```go
type MockInterface struct {
    mock.Mock
}

func (_m *MockInterface) Get(ctx context.Context, id string) (*model.Data, error) {
    ret := _m.Called(ctx, id)

    var r0 *model.Data
    if rf, ok := ret.Get(0).(func(context.Context, string) *model.Data); ok {
        r0 = rf(ctx, id)
    } else {
        if ret.Get(0) != nil {
            r0 = ret.Get(0).(*model.Data)
        }
    }

    var r1 error
    if rf, ok := ret.Get(1).(func(context.Context, string) error); ok {
        r1 = rf(ctx, id)
    } else {
        r1 = ret.Error(1)
    }

    return r0, r1
}

func (_m *MockInterface) Update(ctx context.Context, data *model.Data) error {
    ret := _m.Called(ctx, data)

    var r0 error
    if rf, ok := ret.Get(0).(func(ctx context.Context, data *model.Data) error); ok {
        r0 = rf(ctx context.Context, data *model.Data)
    } else {
        r0 = ret.Error(0)
    }

    return r0
}
```

In the test, we can either specify a value or a stub function for a return variable.

```go
type TestSuite struct {
    suite.Suite
    interfaceStub *InterfaceMock
}

func (s *TestSuite) Test_Get_HappyPath() {
    s.interfaceStub.On("Get", mock.Anything, mock.Anything).Return(&model.Data{ID: "some ID"}, func(ctx context.Context, id string) error {
        if id == "error case" {
            return errors.New("failed to get")
        }
        return nil
    }))

    // test the functions we want to test
    ....

    s.NoError(err)
    s.interfaceStub.AssertCalled(s.T(), "Get", mock.Anything, "some ID")
    s.interfaceStub.AssertNumberOfCalls(s.T(), "Get", 1)
}
```

This pattern kind of combines the idea of the above two patterns. In addition, the best part is that the mock is autogenerated. Of course, you can also modify it if necessary. All those tools (`testify.mock` and `mockery`) make writing test less verbose. But there is still one thing I don't like about this pattern, I have to pass `suite.T()` as a parameter to the asserting functions. I will be happy to know a better way to use `suite` and `mock` packages together.


* Featured image is from https://semaphoreci.com