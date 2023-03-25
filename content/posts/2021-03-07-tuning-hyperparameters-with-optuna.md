---
title: "Tuning Hyperparameters with Optuna"
description: "Achieve the optimal ML model in an automated and smart way"
date: 2021-03-07T00:00:00
draft: false
showToc: true
tocOpen: true
cover:
    image: https://miro.medium.com/v2/resize:fit:1100/0*tGXphGwXZ3O0eIW_
    caption: Photo by [Alexis Baydoun](https://unsplash.com/@alexisbaydoun?utm_source=medium&utm_medium=referral) on [Unsplash](https://unsplash.com/?utm_source=medium&utm_medium=referral)
---

[//]: # (![]&#40;https://miro.medium.com/v2/resize:fit:1100/0*tGXphGwXZ3O0eIW_&#41;)

## Introduction
I recently finished my first machine learning project on Kaggle, predicting sale price with the Boston Housing dataset (co-author: [Julia Yang](https://medium.com/u/ec687522df18?source=post_page-----af342facc549--------------------------------)). Please find our work, which achieved top 9% among 5k competitors, at [[Top 9%] House Price](https://www.kaggle.com/garylucn/top-9-house-price).

From this project, Julia and I both learnt a lot, and we will write up a series of articles about our learnings. In this one, I would like to discuss my experience with tuning hyperparameters of ML models using Optuna.

## Hyperparameters and scikit-learn Tuning Methods

In a machine learning project, tuning the hyperparameters is one of the most critical steps. Since the ML model cannot learn the hyperparameters from the data, it is our responsibility to tune them. If we don’t pick hyperparameters carefully, all the effort that we spent on the other parts of the project could be in vain.

In scikit-learn, we can use a few approaches to tune the hyperparameters:

1. Exhaustive grid search ([`GridSearchCV`](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GridSearchCV.html) and [`HalvingGridSearchCV`](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.HalvingGridSearchCV.html))

    Essentially, we need to set up a grid of possible combinations of hyperparameters. scikit-learn will try every combination to fit the model and compute the model's performance with the specified scoring method and the specified cross-validation splitter.

2. Random search ([`RandomizedSearchCV`](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.RandomizedSearchCV.html) and [`HalvingRandomSearchCV`](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.HalvingRandomSearchCV.html))

    These methods also require us to set up a grid of hyperparameters. But in a random search, not all parameter values are tried out, but rather a fixed number (n_iter) of parameter settings is sampled from the grid.

3. scikit-learn also provides some model-specific cross-validation methods which we can use to tune the hyperparameters, for example, [`RidgeCV`](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.RidgeCV.html), [`LassoCV`](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LassoCV.htm), and [`ElasticNetCV`](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.ElasticNetCV.html) etc. These methods are possible because those models can fit data for a range of some hyperparameters' values almost as efficiently as fitting the estimator for a single value of the hyperparameters.

However, in my experience, those methods seem to have a few problems.

For some context, in our work with predicting the house price, we used six different models to fit and predict the data and then ensemble those models together to be the final model. Therefore, I need to tune the hyperparameters of all those six models. Since some models have quite a few hyperparameters, the grid search methods of scikit-learn will get very expensive pretty fast. For example, when I tune `Ridge`, I only need to tune to alpha and try 10 different values of it, and the grid search will fit the model 10 times. Still, when I tune `XGBRegressor`, if I want to tune 6 hyperparameters and try 10 different values of each of them, the grid search will have to fit the model 1,000,000 times.

On the other hand, in contrast to grid search, the random search can limit the budget of fitting the models, but it seems too random to find the hyperparameters' best combination.

To overcome these problems with the methods from scikit-learn, I searched on the web for tools, and I found a few packages for hyperparameter tuning, including [Optuna](https://optuna.org/) and [Ray.tune](https://docs.ray.io/en/latest/tune/index.html). In this article, I will share my experience with Optuna.

## Tuning Hyperparameters with Optuna

Optuna is “an open-source hyperparameter optimization framework to automate hyperparameter search.” The key features of Optuna include “automated search for optimal hyperparameters,” “efficiently search large spaces and prune unpromising trials for faster results,” and “parallelize hyperparameter searches over multiple threads or processes.” (Quote from https://optuna.org/)

I don’t know too much detail about Optuna’s hyperparameter search algorithm, so I’d like to focus on how to use Optuna.

The first step is to define the objective function for Optuna to maximize. The objective function should take a `Trial` object as the input and return the score, a float value or a list of float values. Here is an example of the objective function that I defined for the Ridge model:

```python
def ridge_objective(trial):
    # Use the trial object to suggest a value for alpha
    # Optuna will come up with a suggested value based on the scores of previous trials
    _alpha = trial.suggest_float("alpha", 0.1, 20)
    # Define the model with the suggested alpha
    ridge = Ridge(alpha=_alpha, random_state=42)
    # Calculate the score with 10-folds cross validation, which returns a list of scores
    # scoring is defined as negative RMSE as it is what this Kaggle competition uses to evaluate the result
    scores = cross_val_score(ridge, X, y, 
                             cv=KFold(n_splits=10,
                                      shuffle=True,
                                      random_state=42),
                             scoring="neg_root_mean_squared_error"
                            )
    # Return the mean of 10 scores
    return scores.mean()
```

The next step is to use the objective function to create a `Study` object and then optimize it.

```python
# Create Study object
study = optuna.create_study(direction="maximize")
# Optimize the study, use more trials to obtain better result, use less trials to be more cost-efficient
study.optimize(objective, n_trials=100) # Use more 
# Print the result
best_params = study.best_params
best_score = study.best_value
print(f"Best score: {best_score}\n")
print(f"Optimized parameters: {best_params}\n")
```

That’s all. It looks simple, right? Let’s put them together with all the models.

```python
RANDOM_SEED = 42

# 10-fold CV
kfolds = KFold(n_splits=10, shuffle=True, random_state=RANDOM_SEED)
# Define the helper function so that it can be reused
def tune(objective):
    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=100)

    params = study.best_params
    best_score = study.best_value
    print(f"Best score: {best_score}\n")
    print(f"Optimized parameters: {params}\n")
    return params
##################
# Ridge
##################
def ridge_objective(trial):
    _alpha = trial.suggest_float("alpha", 0.1, 20)
    ridge = Ridge(alpha=_alpha, random_state=RANDOM_SEED)
    scores = cross_val_score(
        ridge, X, y, cv=kfolds,
        scoring="neg_root_mean_squared_error"
    )
    return scores.mean()

ridge_params = tune(ridge_objective)
# After tuning it for once, we can copy the best params to create the model without tuning it again
# ridge_params = {'alpha': 7.491061624529043}
ridge = Ridge(**ridge_params, random_state=RANDOM_SEED)
##################
# Lasso
##################
def lasso_objective(trial):
    _alpha = trial.suggest_float("alpha", 0.0001, 1)
    lasso = Lasso(alpha=_alpha, random_state=RANDOM_SEED)
    scores = cross_val_score(
        lasso, X, y, cv=kfolds,
        scoring="neg_root_mean_squared_error"
    )
    return scores.mean()
lasso_params = tune(lasso_objective)
# lasso_params = {'alpha': 0.00041398687418613947}
lasso = Lasso(**lasso_params, random_state=RANDOM_SEED)
##################
# Random Forest
##################
def randomforest_objective(trial):
    _n_estimators = trial.suggest_int("n_estimators", 50, 200)
    _max_depth = trial.suggest_int("max_depth", 5, 20)
    _min_samp_split = trial.suggest_int("min_samples_split", 2, 10)
    _min_samples_leaf = trial.suggest_int("min_samples_leaf", 2, 10)
    _max_features = trial.suggest_int("max_features", 10, 50)

    rf = RandomForestRegressor(
        max_depth=_max_depth,
        min_samples_split=_min_samp_split,
        min_samples_leaf=_min_samples_leaf,
        max_features=_max_features,
        n_estimators=_n_estimators,
        n_jobs=-1,
        random_state=RANDOM_SEED,
    )

    scores = cross_val_score(
        rf, X, y, cv=kfolds, scoring="neg_root_mean_squared_error"
    )
    return scores.mean()

randomforest_params = tune(randomforest_objective)
# randomforest_params = {'n_estimators': 180, 'max_depth': 18, 'min_samples_split': 2, 'min_samples_leaf': 2, 'max_features': 49}
rf = RandomForestRegressor(n_jobs=-1, random_state=RANDOM_SEED, **randomforest_params)
# So on with other models...
```

Please find the full code at https://www.kaggle.com/garylucn/top-9-house-price/notebook or https://github.com/glucn/kaggle/blob/main/House_Prices/notebook/top-9-house-price.ipynb

## Conclusion
I’m pretty satisfied with Optuna, as the tuning process is much faster than scikit-learn’s grid search, and the result is better than a random search. Here are some items that I will keep digging in the next step:

1. Have some experiments with other tools like Ray.tune.
2. In the objective function, I need to assign a range for each hyperparameter. If I had a better understanding of the models, I could have made the range more accurate to improve the score or save some budget. So an essential work for me is to dive deeper into those models.

Other articles from Julia and me about data science topics:

- [Compare & Contrast: Exploration of Datasets with Many Features](https://levelup.gitconnected.com/compare-contrast-eda-of-datasets-with-many-features-f9665da15132)

## References
- [scikit-learn: Tuning the hyper-parameters of an estimator](https://scikit-learn.org/stable/modules/grid_search.html)
- [Hyperparameter Tuning in Python: a Complete Guide 2021](https://neptune.ai/blog/hyperparameter-tuning-in-python-a-complete-guide-2020)
