/*jslint todo: true */
/**
 * EXPERIMENTAL Highcharts module to place labels next to a series in a natural position.
 *
 * TODO:
 * - avoid collision with other labels
 * - add column support (box collision detection, same as above)
 * - prefer position above for series ending higher than the rest, below for series ending lower
 * - avoid data labels
 * 
 * // http://jsfiddle.net/highcharts/y5A37/
 */

/*global Highcharts */
(function (H) {

    'use strict';

    var labelDistance = 8,
        wrap = H.wrap,
        each = H.each;

    H.extend(H.Series.prototype, {
        kdDimensions: 1,
        kdTree: null,
        kdAxisArray: ['plotX', 'plotY'],
        kdComparer: 'distR',

        buildKDTree: function () {
            var series = this,
                dimensions = series.kdDimensions;

            // Internal function
            function kdtree(points, depth, dimensions) {
                var axis, median, length = points && points.length;

                if (length) {

                    // alternate between the axis
                    axis = series.kdAxisArray[depth % dimensions];

                    // sort point array
                    points.sort(function(a, b) {
                        return a[axis] - b[axis];
                    });

                    median = Math.floor(length / 2);

                    // build and return node
                    return {
                        point: points[median],
                        left: kdtree(points.slice(0, median), depth + 1, dimensions),
                        right: kdtree(points.slice(median + 1), depth + 1, dimensions)
                    };

                }
            }

            //setTimeout(function () {
            series.kdTree = kdtree(series.points, dimensions, dimensions);
            //});
        },

        searchKDTree: function (point) {
            var series = this,
                kdComparer = this.kdComparer,
                xAxis,
                yAxis,
                inverted,
                s;

            // Internal function
            function getDistance(p1, p2) {
                var x = Math.pow(p1.plotX - p2.plotX, 2) || null,
                    y = Math.pow(p1.plotY - p2.plotY, 2) || null,
                    r = x + y;
                return {
                    distX: x ? Math.sqrt(x) : Number.MAX_VALUE,
                    distY: y ? Math.sqrt(y) : Number.MAX_VALUE,
                    distR: r ? Math.sqrt(r) : Number.MAX_VALUE
                };
            }
            function doSearch(search, tree, depth, dimensions) {
                var point = tree.point,
                    axis = series.kdAxisArray[depth % dimensions],
                    tdist,
                    sideA,
                    sideB,
                    ret = point,
                    nPoint1,
                    nPoint2;

                point.dist = getDistance(search, point);

                // Pick side based on distance to splitting point
                tdist = search[axis] - point[axis];
                sideA = tdist < 0 ? 'left' : 'right';

                // End of tree
                if (tree[sideA]) {
                    nPoint1 = doSearch(search, tree[sideA], depth + 1, dimensions);

                    ret = (nPoint1.dist[kdComparer] < ret.dist[kdComparer] ? nPoint1 : point);

                    sideB = tdist < 0 ? 'right' : 'left';
                    if (tree[sideB]) {
                        // compare distance to current best to splitting point to decide wether to check side B or not
                        if (Math.sqrt(tdist * tdist) < ret.dist[kdComparer]) {
                            nPoint2 = doSearch(search, tree[sideB], depth + 1, dimensions);
                            ret = (nPoint2.dist[kdComparer] < ret.dist[kdComparer] ? nPoint2 : ret);
                        }
                    }
                }
                return ret;
            }

            if (this.kdTree) {
                xAxis = this.xAxis[0];
                yAxis = this.yAxis[0];
                inverted = this.inverted;
                s = {
                    plotX: inverted ? xAxis.len - point.chartY + xAxis.pos : point.chartX - xAxis.pos,
                    plotY: inverted ? yAxis.len - point.chartX + yAxis.pos : point.chartY - yAxis.pos
                };
                return doSearch(s, this.kdTree, this.kdDimensions, this.kdDimensions);
            }

        },

        /**
         * Points to avoid. In addition to actual data points, the label should avoid
         * interpolated positions.
         */
        getPointsToAvoid: function () {
            var points = this.points,
                interpolated = [],
                i,
                deltaX,
                deltaY,
                delta,
                n,
                j;

            for (i = 0; i < points.length; i += 1) {

                if (i > 0) {
                    deltaX = Math.abs(points[i].plotX - points[i - 1].plotX);
                    deltaY = Math.abs(points[i].plotY - points[i - 1].plotY);
                    delta = Math.max(deltaX, deltaY);
                    if (delta > labelDistance) {
                        n = Math.ceil(delta / labelDistance);

                        for (j = 1; j < n; j += 1) {
                            interpolated.push({
                                plotX: points[i - 1].plotX + (points[i].plotX - points[i - 1].plotX) * (j / n),
                                plotY: points[i - 1].plotY + (points[i].plotY - points[i - 1].plotY) * (j / n)
                            });
                        }
                    }
                }

                interpolated.push(points[i]);
            }
            return interpolated;
        }
    });


    /**
     * Check whether a proposed label position is clear of other elements
     */
    H.Chart.prototype.checkClearPoint = function (x, y, bBox) {
        var pointResults = [],
            labelX,
            labelY,
            dist;

        // For each possible position, make sure that all of the label is more than {distance}
        // away from the graph.
        for (labelX = 0; labelX <= bBox.width; labelX += labelDistance) {
            for (labelY = 0; labelY <= bBox.height; labelY += labelDistance) {
                dist = H.Series.prototype.searchKDTree.call(this, { chartX: this.plotLeft + x + labelX, chartY: this.plotTop + y + labelY }).dist.distR;
                if (dist < labelDistance) {
                    return false;
                }

                pointResults.push({
                    x: x,
                    y: y,
                    dist: dist
                });

                if (labelY + labelDistance > bBox.height) {
                    labelY = bBox.height;
                }
            }
            if (labelX + labelDistance > bBox.width) {
                labelX = bBox.width;
            }
        }
        pointResults.sort(function (a, b) {
            return a.dist - b.dist;
        });

        return pointResults[0];
    };


    function drawLabels(proceed) {

        proceed.call(this);

        //console.time('labelBySeries');

        this.buildTreeToAvoid();

        each(this.series, function (series) {

            var chart = series.chart,
                bBox,
                x,
                y,
                results = [],
                clearPoint,
                i,
                best,
                points = series.points;

            if (!series.labelBySeries) {
                series.labelBySeries = chart.renderer.label(series.name, 0, -9999)
                    .css({
                        color: series.color,
                        fontWeight: 'bold'
                    })
                    .add(series.group);
            }

            bBox = series.labelBySeries.getBBox();
            bBox.width = Math.round(bBox.width);



            // Ideal positions are centered above or below a point on right side of chart
            for (i = points.length - 1; i > 0; i -= 1) {

                // Try above
                x = (points[i].plotX - bBox.width / 2);
                y = points[i].plotY - bBox.height - labelDistance;
                if (x <= chart.plotWidth - bBox.width && y >= 0) {
                    best = chart.checkClearPoint(
                        x,
                        y,
                        bBox
                    );
                }
                if (best) {
                    break;
                }

                // Try below
                x = (points[i].plotX - bBox.width / 2);
                y = points[i].plotY + labelDistance;
                if (x <= chart.plotWidth - bBox.width && y <= chart.plotHeight - bBox.height) {
                    best = chart.checkClearPoint(
                        x,
                        y,
                        bBox
                    );
                }
                if (best) {
                    break;
                }
            }


            // Brute force, try all positions on the chart in a 16x16 grid
            // TODO: Instead of keeping all points and using the closest, keep all
            // points between for instance 0.5 and 1.5 * labelDistance, and use the 
            // one furthest to the right on the chart. A possibility to use points further
            // away would be to add a connector. Also, a more fine grained grid could be
            // scrutinized if this doesn't lead to success.
            if (!best) {
                for (x = chart.plotWidth - bBox.width; x >= 0; x -= 16) {
                    for (y = 0; y < chart.plotHeight - bBox.height; y += 16) {
                        clearPoint = chart.checkClearPoint(x, y, bBox);
                        if (clearPoint) {
                            results.push(clearPoint);
                        }
                    }
                }
                results.sort(function (a, b) {
                    return a.dist - b.dist;
                });
                best = results[0];
            }

            //
            series.labelBySeries.attr({
                x: best.x,
                y: best.y
            });
        });
        //console.timeEnd('labelBySeries');

    }
    wrap(H.Chart.prototype, 'render', drawLabels);
    wrap(H.Chart.prototype, 'redraw', drawLabels);

    H.Chart.prototype.buildTreeToAvoid = function () {
        var points = [];

        each(this.series, function (series) {
            points = points.concat(series.getPointsToAvoid());
        });

        // Borrow the kdTree method from series and run on the points to avoid
        this.points = points;
        this.kdDimensions = 2;
        this.kdAxisArray = ['plotX', 'plotY'];
        this.kdComparer = 'distR';
        H.Series.prototype.buildKDTree.call(this);
    };




}(Highcharts));