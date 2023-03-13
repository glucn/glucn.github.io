---
title: "Querying Data in an Array of Nested Structures"
date: 2018-03-12T00:00:00
draft: false
---


Our data models often contain complex data types and nested structures. In this post, I will use an example to discuss how to query the data in an array of nested structures with Elasticsearch, BigQuery, and Cloud SQL (MySQL).

## Background

Let us assume we are working with the data of sales orders, and the data model is like this: 

``` 
{
  order_id: string,
  order_items: [
    {
      product_id: string
      shipping_status: string enum ("PENDING", "SHIPPED")
      ...
    }, {...}, {...} ...
  ],
  ...
} 
```

The field `order_items` is an array of a nested structure which contains fields like `product_id`, `shipping_status` etc. Now we want to get the list of all pending order items in the sales orders, so we need to lookup the data with `shipping_status` equals to `"PENDING"`.

## Elasticsearch

In Elasticsearch, we can query the nested objects with [Nested Query](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-nested-query.html). A nested query is executed against the nested objects as if they were indexed as separate docs (they are, internally) and resulting in the parent document. However, a simple nested query on `SalesOrders` model will return the whole model, while we want to know which inner nested `OrderItems` is in `"PENDING"` status. In this case, we need to define [Inner Hits](https://www.elastic.co/guide/en/elasticsearch/reference/current/search-request-inner-hits.html) in the nested query, which returns the nested hits in addition to the search response. Taking a step further, we can use `_source` field to disable including the parent `SalesOrders` model in the response and solely retrieve the inner hits, this can improve the performance of both data querying and transferring. 

At the end of the day, the query ends up like this: 

```
GET xxxxxxx/_search
{
  "_source": false, 
  "query": {
    "bool": {
      "filter": [
        {
          "nested": {
            "inner_hits": {},
            "path": "order_items",
            "query": {
              "term": {
                "order_items.shipping_status": "PENDING"
              }
            }
          }
        }
      ]
    }
  }
}
```

And the response will be like the following example. The only concern is that the data that we need hide in the deep layer of the JSON, we need to call `hits.hits.inner_hits.xxxx.hits.hits` to access them. 

```
{
  "took": 12,
  "timed_out": false,
  "_shards": {
    "total": 5,
    "successful": 5,
    "failed": 0
  },
  "hits": {
    "total": 10,
    "max_score": 0,
    "hits": [
      {
        "_index": "xxxxxxx",
        "_type": "SalesOrders",
        "_id": "xxxxxxx",
        "_score": 0,
        "inner_hits": {
          "order_items": {
            "hits": {
              "total": 1,
              "max_score": 9.047254,
              "hits": [
                {
                  "_type": "SalesOrders",
                  "_id": "xxxxxxx",
                  "_nested": {
                    "field": "order_items",
                    "offset": 0
                  },
                  "_score": 9.047254,
                  "_source": {
                    "product_id": "xxxxxxx",
                    "status": "PENDING",
                    ...
                  }
                }
              ]
            }
          }
        }
      }
    ]
  }
}
```

## BigQuery

Can we query the data in the same nested structure with BigQuery? The answer is yes, and the query in BigQuery is much more straightforward than in Elasticsearch. 

```
SELECT order.order_id, item.product_id, item.status
FROM `xxxxxxxx` as order
CROSS JOIN
      UNNEST(order_items) as item
where item.status = "PENDING" LIMIT 1000
```

The [UNNEST](https://cloud.google.com/bigquery/docs/reference/standard-sql/query-syntax#unnest) operator takes an array and returns a table, with one row for each element in the array. In this query, we use the `CROSS JOIN` operator to join the table to the UNNEST output of that array column, and it can be ignored. The following query will return the same result: 

```
SELECT order.order_id, item.product_id, item.status
FROM `xxxxxxxx` as order,
      UNNEST(order_items) as item
where item.status = "PENDING" LIMIT 1000
```

## Google Cloud SQL

Google Cloud SQL supports MySQL and PostgreSQL, in this post, we will focus on MySQL version. We can also query data in an array of nested structures, but we need to do it in a hacky way. An array of nested structures is stored in MySQL column as a JSON string. In the version of MySQL supported by Google Cloud SQL (v5.5 - 5.7), we do not have a built-in function to flatten a JSON array to a table, we have to mimic that operation ourselves: 

```
SELECT order_id, idx, 
    json_unquote(json_extract(order_items, concat('$[', idx, '].product_id'))) as product_id,
    json_unquote(json_extract(order_items, concat('$[', idx, '].status')) as status
FROM xxxxxx
JOIN ( -- build a integer sequence as long as it need to be
 select 0 as idx UNION
 select 1 as idx UNION
 select 2 as idx UNION
 select 3 as idx
 ...
) as indexes
WHERE json_unquote(json_extract(order_items, concat('$[', idx, '].status')) = 'PENDING'
```

A recent version of MySQL (Community Server 8.0.4-rc) has the `JSON_TABLE()` function, which accepts JSON data and returns it as a relational table whose columns are as specified. But we cannot use that function in Cloud SQL until it supports the newer version MySQL.

## Comparision

All of these three databases can support our requirement of looking up data in nested structures, but which one is faster? I did a tiny experiment with `SalesOrders` model having 373 entities. I tried to query the entities with `order_items.status = "PENDING"`, and there were 159 hits. The time range each secondary index took were:

*   Elasticsearch: 12 ~ 200 ms
*   BigQuery: 2.4 ~ 3.2 s
*   Cloud SQL: 0.1 ~ 0.5 s

Apparently, the performance of Elasticsearch is the best, but on the other hand, Elasticsearch is normally considered unstable. Anyway, no matter which database we are working with, I hope this post can provide us some idea of how to query data in a complex nested structure.

###### References

*   [BigQuery: Working with Arrays](https://cloud.google.com/bigquery/docs/reference/standard-sql/arrays)
*   [MySQL: MySQL Community Server 8.0.4-rc](https://lists.mysql.com/announce/1240)