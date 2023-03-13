---
title: "How to use Javascript library in Typescript Angular project"
date: 2018-02-18T00:00:00
draft: false
---

## The Problem
Hackathon is a great part of the culture of my company. In the two days event every two months, we can work on basically anything that we believe beneficial for the company.

In the recent Hackathon, I spent my time on introducing a Gantt chart to our team dashboard. The codebase of the team dashboard is an Angular 2 project written in Typescript. I tried several Gantt packages, the one I liked most is a Javascript package [dhtmlxGantt](https://dhtmlx.com/docs/products/dhtmlxGantt/). But how could we use this Javascript package in the project?

## The Solution
#### Step 1. Find the type definition of Javascript library
Typescript is the strict syntactical superset of JavaScript. The functions and variables can have defined types in Typescript, while it is not important in Javascript. When we are going to use an external JS library we need to declare type definitions for TypeScript. Do we need to write it? Before writing it ourselves, there are several places we should check out.

###### Inside the JS library
Some JS libraries, like [brace](https://github.com/thlorenz/brace), provide the type definition files(`.d.ts`) which define types and standardize the arguments for TS. In this case, we can use the library directly. 

Unfortunately, `dhtmlxGantt` does not provide `.d.ts` file in the library.

###### DefinitelyTyped
[DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) is a great repository holding the type definitions of thousands JS libraries. We can use [Type Search](https://microsoft.github.io/TypeSearch/) to find the declaration file for the libraries we need, and I found `@types/dhtmlxgantt` here.

###### npm and Github
Before we move on, I would like to suggest to search on npm and Github for personal packages/repositories that related to the JS library you want to use. Some of them could even be a better choice than the package in DefinitelyTyped. 
For example, [gantt-ui-component](https://github.com/dking3876/gantt-ui-component) is also a wonderful TS wrapper of dhtmlxGantt.

If we failed to find the type definition, we have to write it ourselves. But it is another story, we can discuss it someday later.

#### Step 2. Install the library in the project
In order to use the library, we need to install the library in the project. For example, in the case of dhtmlxGantt, we should run following commands:
```
npm install dhtmlx-gantt --save
npm install @types/dhtmlxgantt --save-dev
```

These two packages will appear in the `dependencies` section in `package.json`.

#### Step 3. Import the library into the component
Now, we can import the library into the component file and use the library.

```
import 'dhtmlx-gantt';

// or more explicitly,
// import * as gantt from 'dhtmlx-gantt';
@Component({
    selector: "gantt-chart",
    template: "<div #gantt></div>",
    styleUrls: ['./gantt-chart-component.scss']
})
export class GanttChartComponent implements OnInit {
    @ViewChild("gantt") ganttContainer: ElementRef;

    ngOnInit(){
        gantt.init(this.ganttContainer.nativeElement);
    }
}
```

#### Step 4. Import the stylesheet
At this point, the Gantt chart should be present on the page, well, super ugly. This is because the styling is missing, so we want to import the css file in dhtmlxgantt library into our project.

One approach to import an external css file from node_modules is importing the css file in `gantt-chart-component.scss` and applying it with Shadow Piercing combinators.

```
::ng-deep { // shadow piercing
    @import "../../node_modules/dhtmlx-gantt/codebase/dhtmlxgantt.css";
}

:host { // styles in the element that hosts the component
    display: block;
    position: relative;
    width: 100%;
}
```

The reason we need shadow piercing combinator is that component styles apply only to the HTML in the component's own template, while we want to apply them to the child component views. A tricky thing is that `::ng-deep`, as well as its alias `/deep/` and `>>>`, is being deprecated. But as long as there is no clear roadmap of replacing them, it should be safe to keep on using the `::ng-deep` combinator.

Some CLI tools might not support such relative path of the css file. I ran into this problem in our team dashboard project with webpack 3 as the CLI tool, so I defined an alias of the css file in webpack.config.js.
```
config.resolve = {
  extensions: ['.ts', '.js', '.scss', '.html'],
  modules: [path.join(__dirname, 'node_modules')],
  alias: {
    dhtmlxgantt: path.join(__dirname, '/node_modules/dhtmlx-gantt/codebase/dhtmlxgantt.css')
  }
};
```

And the import statement of this css file could be updated to:

```
::ng-deep {
    @import "~dhtmlxgantt";
}
```

Problem solved!

#### Highlights
* Type defnition files is necessary for using JS library in TS Angular project. If the library does not provide it, we could look for it on [Type Search](https://microsoft.github.io/TypeSearch/).
* We can import an external css file in the style sheet file of a TS component, and we need shadow piercing combinators(`::ng-deep`) to apply styles to the child component views.


###### References
* [dhtmlx blog: Using dhtmlxScheduler and dhtmlxGantt with TypeScript](https://dhtmlx.com/blog/using-dhtmlxscheduler-and-dhtmlxgantt-with-typescript/)
* [dhtmlx blog: DHTMLX Gantt Chart Usage with Angular 2 Framework](https://dhtmlx.com/blog/dhtmlx-gantt-chart-usage-angularjs-2-framework/)
* [Hackernoon: How to use JavaScript libraries in Angular 2+ apps](https://hackernoon.com/how-to-use-javascript-libraries-in-angular-2-apps-ff274ba601af)
* [Angular: Component Styles](https://angular.io/guide/component-styles)
* [Hackernoon: The New Angular ::ng-deep and the Shadow-Piercing Combinators Drop](https://hackernoon.com/the-new-angular-ng-deep-and-the-shadow-piercing-combinators-deep-and-drop-4b088dbe459)