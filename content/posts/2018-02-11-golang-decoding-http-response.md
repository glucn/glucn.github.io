---
title: "Golang: Decoding HTTP Response"
date: 2018-02-11T00:00:00-07:00
draft: false
---

## TL;DR
* Each step of deployment process should be independent of each other.
* `json.Unmarshal` applies to single JSON object, `json.Decoder#Decode` applies to JSON stream.

## The Problem
I was working on a Go project, and one of the functions could decode an HTTP response to a Customer object. The HTTP response was a JSON like:
```
{
  "data": {
    "id": 123,
    "name": "Jason"
  }
}
```

The old decoding code was:

```
import (
	"encoding/json"
	"errors"
	"net/http"
)

type Customer struct {
  ID    int    `json:"id"`
  Name  string `json:"name"`
}

func dataFromResponse(r *http.Response) (*Customer, error) {
  defer r.Body.Close()
  type Response struct {
    Customer *Customer `json:"data"`
  }
  res := Response{}
  if err := json.NewDecoder(r.Body).Decode(&res); err != nil {
    return nil, util.Error(util.Internal, "failed to convert response to Customer: %s", err.Error())
  }
  return res.Customer, nil
}
```

For a very good reason, we were going to change the ID field from int type to string type.
```
{
  "data": {
    "id": "123",
    "name": "Jason"
  }
}
```

The change seemed to be painless, but having service availability in mind, I would say it was not that straightforward.

## The Solution
The client, which decode the response, and the server, which send out the response, were two different projects. If I simply had two PRs that change the type on each side, it could not be guaranteed that they could be deployed at the exact same time. (I'd like to blame Jenkins, lol). So, these were the three steps I did for this change:
1. Client - take in both ID in int and ID in string
2. Server - send out ID in string
3. Client - accept only string type ID

The third step was not super necessary. The only reason I did that was I did not like the hacky logic for step 1. I personally value the code readability over unnecessary robustness.

My code for step 1 was:

```
import (
	"encoding/json"
	"errors"
	"net/http"
)

type CustomerStringId struct {
  ID    string `json:"id"`
  Name  string `json:"name"`
}

type CustomerIntId struct {
  ID    string `json:"id,int"` // decode it from int in JSON to string
  Name  string `json:"name"`
}

func dataFromResponse(r *http.Response) (*Customer, error) {
  // copy the content of response body, so it can be reused later
  body, err := ioutil.ReadAll(r.Body)
  if err != nil {
    return nil, util.Error(util.Internal, "failed to read the body of response: %s", err.Error())
  }
  defer r.Body.Close()
  type Response struct {
    Customer *CustomerStringId `json:"data"`
  }
  // try to decode body to CustomerStringId
  res := Response{}
  err = json.Unmarshal(body, &res)
  if err != nil {
    // if failed, try to decode body to CustomerIntId
    type Response struct {
        Customer *CustomerIntId `json:"data"`
    }

    resInt := Response{}
    if err := json.Unmarshal(body, &resInt); err != nil {
      return nil, errors.New("failed to convert response to Customer: %s", err.Error())
    }
    // copy CustomerIntId to CustomerStringId
    res.Customer.ID = resInt.Customer.ID
    res.Customer.Name = resInt.Customer.Name
  }
  return res.Customer, nil
}
```

This method could try twice to decode the response. The first run was unmarshaling ID from the string type, and the second run was from the int type. In this case, I could not use `json.Decoder#Decode`, since it would read the response message to EOF and could not be rewind. Instead, the response body was read into a variable and decoded with `json.Unmarshal`.

After step 3, the code was simplified back to only accepting string input.

```
import (
	"encoding/json"
	"errors"
	"net/http"
)

type Customer struct {
  ID    string `json:"id"`
  Name  string `json:"name"`
}

func dataFromResponse(r *http.Response) (*Customer, error) {
  body, err := ioutil.ReadAll(r.Body)
  if err != nil {
    return nil, util.Error(util.Internal, "failed to read the body of response: %s", err.Error())
  }
  defer r.Body.Close()
  type Response struct {
    Customer *Customer `json:"data"`
  }
  res := Response{}
  if err := json.Unmarshal(body, &res); err != nil {
      return nil, errors.New("failed to convert response to Customer: %s", err.Error())
  }
  return res.Customer, nil
}
```

At this point, it seemed that the problem had been solved, but I got another question in my mind. Before this change, `json.Decoder#Decode` was the function for decoding, and it was replaced with `json.Unmarshal` during the change. Both functions seemed to be working fine, so what's the difference of them?

After some research, I got the following conclusion:
* Use `json.Decoder#Decode` if the data is coming from a stream.
* Use `json.Unmarshal` if the JSON data has already been in memory.

In my case, `json.Unmarshal` could be a better choice since the response was not a stream and the data size allowed me to load it into memory.

Problem solved!

###### References</h5>
[Golang Official Document - Package json](https://golang.org/pkg/encoding/json/)