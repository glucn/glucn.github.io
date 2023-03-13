---
title: "Data Consistency in Google Cloud Datastore"
date: 2018-02-04T00:00:00
draft: false
---

Back to the era of the relational database, I was barely worried about data consistency problem. DBMS could take care of it as a basic property. However, NoSQL databases have emerged in recent years and are playing more and more important roles with strong scalability. In NoSQL database, data consistency is not always a basic property anymore.

## The Problem
The project I am working on is backed by Google Cloud Datastore. In the project, we have `Customer` model and `Account` model. The key in `Customer` model is built on `customer_id`, and the key of the `Account` model is built on `account_id`.

Recently, we wanted to add a restriction that each customer can only have one account. My first attempt was to run a query on the `Account` model before creating the account. The simplified code is like this:

```
class Account(ndb.Model):

  @classmethod
  def lookup_for_customer_id(cls, customer_id, keys_only=False):
    return cls.query(cls.customer_id == customer_id).get(keys_only=keys_only)

  @classmethod
  def create_or_get(cls, customer_id, kwargs):
    account = Account.lookup_for_customer_id(customer_id)
    if account:
      return account.account_id
    else:
      def tx():
        # call TinyId for a unique ID
        account_id = Account.generate_account_id() 
        key = Account.build_key(account_id)
        account_entity = Account(key=key, **kwargs)
        account_entity.put()
        return account_entity

      account = ndb.Transaction(tx)
      return account.account_id
```

I had two problems here:

1. It is possible that the query in `lookup_by_customer_id` gets a stale result in which a recently created account is missing due to the consistent problem.
2. If I move the query into the transaction, Datastore will give me an error `Bad Request - queries inside transactions must have ancestors`. So, the query has to happen out of the transaction, and this brings potential race condition issue in the high-concurrency application.

![diagram](https://glucn.files.wordpress.com/2018/02/1.png)

To solve these problems, let's start with two consistency models in Google Cloud Datastore.

## Strong Consistency and Eventually Consistency
In Datastore, there are two levels of data consistency:
* **Strongly Consistency:** queries guarantee the most up-to-date results, but may take longer to complete or may not be supported in certain cases.
* **Eventual Consistency:** queries generally run faster, but may occasionally return stale results.


## Consistency Model of Query APIs
| Cloud Datastore API     | Read of entity value   | Read of index        |
| :---------------------- |:---------------------- | :------------------- |
| Global Query            | Eventual consistency   | Eventual consistency |
| Keys-only Global Query  | N/A                    | Eventual consistency |
| Ancestor Query          | Strong consistency     | Strong consistency   |
| Lookup by key (get())   | Strong consistency     | N/A                  |


#### Global Query
Queries without an ancestor are known as **Global Queries** and designed to work with an eventual consistency model.
```
account = Account.query().filter('customer_id =', customer_id).get()
```

#### Keys-only Global Query
A keys-only global query is a global query that returns only the keys of entities matching the query, not the attribute values of the entities.
```
account = Account.query().filter('customer_id =', customer_id).get(keys_only=True)
```

#### Ancestor Query
An ancestor query limits its results to the specified entity and its descendants. When calling get (by key), Cloud Datastore will flush all pending updates on one of the replicas and index tables, then execute get.
```
ancestor = Customer.build_key(customer_id)
account = Account.query(ancestor=ancestor).get()
```

#### Lookup by key
The lookup by key call returns one entity or a set of entities specified by a key or a set of keys.
```
  account_key = Account.build_key(account_id)
  account = account_key.get()
```

## The Solution
At the end of the day, I decided to create a new mapping table between `customer_id` and `account_id`, in which the key was built on `customer_id`. The code was updated to:

```
class Account(ndb.Model):

  @classmethod
  def lookup_for_customer_id(cls, customer_id, keys_only=False):
    mapping = Mapping.get(customer_id)
    if not mapping:
      return None
    account_key = cls.build_key(mapping.account_id)
    if keys_only:
      return account_key
    else
      return account_key.get()

  @classmethod
  def create_or_get(cls, customer_id, kwargs):
    def tx():
      account = Account.lookup_for_customer_id(customer_id)
      if account:
        return account
      else:
        # call TinyId for a unique ID
        account_id = Account.generate_account_id()
        account_key = Account.build_key(account_id)
        account_entity = Account(key=account_key, **kwargs)
        account_entity.put()
        mapping_key = Mapping.build_key(customer_id)
        mapping_entity = Mapping(key=mapping_key, account_id)
        mapping_entity.put()
        return account_entity

    account = ndb.Transaction(tx, xg=True)
    return account.account_id
```
 

In this chunk of code, `get()` on both `Mapping` and `Account` model can guarantee strong consistency. Similarly, the code of `Account.delete()` was also updated, so that when an `Account` entity was deleted, the corresponding `Mapping` entity should be deleted as well. Moreover, I ran a MapReduce to populate the data into `Mapping` model for all the existing `Account` entities.

![diagram](https://glucn.files.wordpress.com/2018/02/2.png)

Problem solved!

According to the consistency model of APIs, some other solutions could also solve the consistency problem. However, they have some downsides to my problem.

* Using Ancestor Query
Downside: I have to rebuild all the data in `Account` model to introduce ancestor path in their keys. This operation might even require some downtime.

* Appending `account_id` field in `Customer` model
Downside: Actually, this could be a good solution, but it does not suit our situation. The `Customer` model in this project is a replication of the customer data in another project. As this situation is against the idea of the single source of truth, some of my co-workers are planning to eliminate `Customer` model in this project.

By the way, projects in my company are migrating from Datastore to Spanner. In the official documents of Spanner, a new concept "External Consistency" is introduced. I will be looking into that later, and I hope not to have consistency problem again.

###### References
* [Google: Structuring for Strong Consistency](https://cloud.google.com/datastore/docs/concepts/structuring_for_strong_consistency)
* [Google: Balancing Strong and Eventual Consistency with Google Cloud Datastore](https://cloud.google.com/datastore/docs/articles/balancing-strong-and-eventual-consistency-with-google-cloud-datastore/)