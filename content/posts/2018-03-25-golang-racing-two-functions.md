---
title: "Golang: Racing two functions"
date: 2018-03-25T00:00:00
draft: false
---

![](https://glucn.files.wordpress.com/2018/03/race.png)

Golang was born with a great support for concurrency. With go-routines and channels, we can solve some problems easily. Recently, our team applied those techniques in racing two functions that process the same thing but through different routes.


## The Problem
We have some data stored on Google Cloud Spanner, as well as on Elastic. With these two databases, we can implement different queries. In my understanding, Elastic is usually faster than Google Cloud Spanner but less stable, as we always run into the outage of Elastic. So, if we care more about returning the result to the client, we will query the data with Spanner; and if performance is more important, Elastic will be our choice.

However, why don't we kick off two queries on both of the databases, let them race, and return the result from the winner? In this case, we can leverage the performance of Elastic and guarantee the response by Spanner, and the client will not know anything about it. 

## The Solution
First of all, let's have a closer look at the "racing" we want to implement. There are two functions that get the query results from each database (and we don't need to worry about them in this post), we are going to build a "dispatcher" for the two workers, which:

* Returns the result of the worker who comes back first, and kills the other worker;
* Throws an error when both workers fail.

We can address the requirement in several ways, but considering further reusing, we build a `Hedge` for this purpose.
```
type Hedge struct {
	parentCtx context.Context
	cancel    func()

	res   chan struct{}
	err   chan error
	total int64
}

// HedgeWithContext creates a new Hedge and an associated Context 
// derived from ctx.
func HedgeWithContext(ctx context.Context) (*Hedge, context.Context) {
	childCtx, cancel := context.WithCancel(ctx)
	return &Hedge{
		parentCtx: ctx,
		cancel:    cancel,
		res:       make(chan struct{}),
		err:       make(chan error),
		total:     0,
	}, childCtx
}

// Wait blocks until all function calls,
// then returns the first non-nil error (if any) from them, 
// OR a single function call results in success.
func (h *Hedge) Wait() error {
	defer h.cancel()
	if h.total == 0 {
		return nil
	}
	var errs []error
	var success bool
	for {
		if success {
			break
		}
		// all goroutines resulted in err
		if len(errs) == int(h.total) {
			return errs[0]
		}
		select {
		case <-h.res:
			success = true
		case <-h.parentCtx.Done():
			return h.parentCtx.Err()
		case err := <-h.err:
			errs = append(errs, err)
		}
	}
	return nil
}

// Go calls the given function in a new goroutine.
func (h *Hedge) Go(f func() error) {
	atomic.AddInt64(&h.total, 1)
	go func() {
		err := f()
		if err != nil {
			h.err <- err
		} else {
			h.res <- struct{}{}
		}
	}()
}
```

And this is how we use `Hedge`.

```
func (s *Service) Search(ctx context.Context, ..., cursor string, pageSize int64) (*data, string, bool, int64, error) {
	hedged, childCtx := HedgeWithContext(ctx)
	var resultFromES, resultFromSpanner *searchResult
	hedged.Go(func() error {
		var err error
		resultFromES, err = s.searchFromES(childCtx, ..., cursor, pageSize)
		return err
	})
	hedged.Go(func() error {
		var err error
		resultFromSpanner, err = s.searchFromSpanner(childCtx, ..., cursor, pageSize)
		return err
	})
	err := hedged.Wait()
	if err != nil {
		return nil, "", false, 0, err
	}
	if resultFromES != nil {
		return resultFromES.data, resultFromES.cursor, resultFromES.hasMore, resultFromES.totalSize, nil
	}

	return resultFromSpanner.data, resultFromSpanner.cursor, resultFromSpanner.hasMore, resultFromSpanner.totalSize, nil
}
```

Problem solved!

## Extend Discussion
#### Who is the winner?
Surprisingly (at least for me), Spanner wins most of the times, maybe 8 out of 10 times. It even makes us consider to re-build some of the existing queries with Spanner. 
But before that, we need to have more concrete proof, we need to know exactly how many times Elastic wins and how many times Spanner wins. An old-school approach is adding some log before the dispatch returns the result. Instead of that, we will use `Datadog` to generate the statistics. The following statement will be enough.
```
	statsd.Incr("es-spanner-race", []string{"winner:elastic"}, 1)
```

#### Paged query
As you can see from the params of `Search` function, we allow paged query and return the cursor to the client for the next query. But the cursor from Elastic and Spanner are pretty different, and the problem is here. If a client comes back with a cursor from Elastic, should we still race the two databases? No, we should do the query only with Elastic. The idea to solve this problem is having a prefix in the cursor to explicitly indicate the source of the cursor and only kick off one worker.

#### What can we do with Hedging
Other than racing two functions, I believe `Hedge` can be applied in many cases:

* Reducing tail latency
* Improving the availability by increasing redundancy
* Rolling out new features with increased safety


###### References
* Featured Image from: https://talks.golang.org/2014/research2.slide